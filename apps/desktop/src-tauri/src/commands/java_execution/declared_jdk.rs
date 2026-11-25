//! File collection for javac follows explicit provider roots, not conventional workspace guesses.
use super::*;
use crate::commands::refactorkit_daemon::DeclaredJdkCompilation;

pub(super) fn inputs(
    workspace: &Path,
    declaration: &DeclaredJdkCompilation,
) -> Result<(PathBuf, Vec<String>), String> {
    let output = resolve_new_path_in_root(
        workspace,
        declaration
            .output
            .to_str()
            .ok_or("Compiler output path must be UTF-8.")?,
    )?;
    let mut sources = Vec::new();
    let mut visited = 0;
    for root in &declaration.source_roots {
        let root = resolve_existing_path_in_root(
            workspace,
            root.to_str().ok_or("Source root must be UTF-8.")?,
        )?;
        collect(workspace, &root, &output, &mut sources, &mut visited, 0)?;
    }
    sources.sort();
    sources.dedup();
    if sources.is_empty() {
        return Err("The selected declared source set has no Java sources.".into());
    }
    Ok((output, sources))
}
fn collect(
    workspace: &Path,
    directory: &Path,
    output: &Path,
    sources: &mut Vec<String>,
    visited: &mut usize,
    depth: usize,
) -> Result<(), String> {
    if depth > 32 {
        return Err("Declared Java source traversal is too deep.".into());
    }
    if directory.starts_with(output) {
        return Ok(());
    }
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Cannot read declared Java sources: {error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        *visited += 1;
        if *visited > 20_000 {
            return Err("The declared Java source inventory exceeds the compiler limit.".into());
        }
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_symlink() {
            return Err("A declared Java source traversal encountered a symbolic link; synchronize a safe source inventory.".into());
        }
        let path = entry.path();
        if kind.is_dir() {
            collect(workspace, &path, output, sources, visited, depth + 1)?;
        } else if kind.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension == "java")
        {
            let canonical = resolve_existing_path_in_root(
                workspace,
                path.to_str().ok_or("Java source path must be UTF-8.")?,
            )?;
            sources.push(canonical.to_string_lossy().into_owned());
            if sources.len() > 2000 {
                return Err("Too many Java files in the declared source set.".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires IDE_TEST_ALTERNATE_JDK_HOME and a real javac process"]
    fn declared_javac_real_compilation_refuses_implicit_workspace_dependencies() {
        let home = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME").expect("Select the real test JDK");
        let guard = LaunchFile::create("fixture-marker", b"").unwrap();
        let root = guard.path.parent().unwrap().join("project");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("Sneaky.java"), "class Sneaky {}\n").unwrap();
        fs::write(root.join("src/Main.java"), "class Main { Sneaky field; }\n").unwrap();
        let declaration = DeclaredJdkCompilation {
            source_roots: vec![root.join("src")],
            output: root.join("out"),
            compile_classpath: vec![],
            release: 17,
        };
        let request: Request = serde_json::from_value(serde_json::json!({"workspaceId":"fixture","generation":1,"operation":"build","trusted":true,"configuration":{"buildTool":"jdk","mainClass":"Main","classPath":[],"jdkHome":home}})).unwrap();
        let plan = invocation_selected_with_settings(
            &root,
            &request,
            &[],
            false,
            None,
            None,
            InvocationSettings {
                declared_jdk: Some(&declaration),
                ..InvocationSettings::default()
            },
        )
        .unwrap();
        let compile = &plan[0];
        let result = Command::new(&compile.executable)
            .args(&compile.arguments)
            .current_dir(&root)
            .output()
            .unwrap();
        assert!(
            !result.status.success(),
            "An undeclared source was compiled implicitly"
        );
        assert!(String::from_utf8_lossy(&result.stderr).contains("Sneaky"));
        fs::write(
            root.join("src/Main.java"),
            "class Main { public static void main(String[] args) {} }\n",
        )
        .unwrap();
        let result = Command::new(&compile.executable)
            .args(&compile.arguments)
            .current_dir(&root)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(root.join("out/Main.class").is_file());
        assert!(!root.join("out/Sneaky.class").exists());
        fs::remove_dir_all(&root).unwrap();
    }
    #[test]
    fn compiler_uses_declared_roots_including_a_package_named_build_and_excludes_its_output() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let token = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let root = std::env::temp_dir().join(format!("ide-declared-jdk-roots-{token}"));
        fs::create_dir_all(root.join("src/build")).unwrap();
        fs::create_dir_all(root.join("src/classes")).unwrap();
        fs::create_dir_all(root.join("other")).unwrap();
        fs::write(
            root.join("src/build/Main.java"),
            "package build; class Main {}\n",
        )
        .unwrap();
        fs::write(
            root.join("src/classes/Generated.java"),
            "invalid output must not be compiled",
        )
        .unwrap();
        fs::write(
            root.join("other/Excluded.java"),
            "invalid unselected source",
        )
        .unwrap();
        let declaration = DeclaredJdkCompilation {
            source_roots: vec![root.join("src")],
            output: root.join("src/classes"),
            compile_classpath: vec![],
            release: 17,
        };
        let (output, sources) = inputs(&root, &declaration).unwrap();
        assert_eq!(output, root.join("src/classes"));
        assert_eq!(
            sources,
            vec![root
                .join("src/build/Main.java")
                .to_string_lossy()
                .to_string()]
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn declared_javac_plan_uses_release_proc_none_and_only_provider_compile_classpath() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let token = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let root = std::env::temp_dir().join(format!("ide-declared-javac-plan-{token}"));
        fs::create_dir_all(root.join("sdk/bin")).unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        for tool in ["java", "javac"] {
            fs::write(root.join("sdk/bin").join(executable_name(tool)), "").unwrap();
        }
        fs::write(root.join("src/Main.java"), "class Main {}\n").unwrap();
        fs::write(root.join("compiler.jar"), "fixture").unwrap();
        fs::write(root.join("runtime-only.jar"), "fixture").unwrap();
        let declaration = DeclaredJdkCompilation {
            source_roots: vec![root.join("src")],
            output: root.join("out"),
            compile_classpath: vec![root.join("compiler.jar")],
            release: 17,
        };
        let request:Request=serde_json::from_value(serde_json::json!({"workspaceId":"fixture","generation":1,"operation":"build","trusted":true,"configuration":{"buildTool":"jdk","mainClass":"Main","classPath":["runtime-only.jar"],"jdkHome":root.join("sdk")}})).unwrap();
        let plan = invocation_selected_with_settings(
            &root,
            &request,
            &[],
            false,
            None,
            None,
            InvocationSettings {
                declared_jdk: Some(&declaration),
                ..InvocationSettings::default()
            },
        )
        .unwrap();
        assert_eq!(plan.len(), 1);
        let args = &plan[0].arguments;
        assert!(args.windows(2).any(|pair| pair == ["--release", "17"]));
        assert!(args.iter().any(|arg| arg == "-proc:none"));
        let cp = args.iter().position(|arg| arg == "-classpath").unwrap();
        assert_eq!(args[cp + 1], root.join("compiler.jar").to_string_lossy());
        assert!(!args.iter().any(|arg| arg.contains("runtime-only.jar")));
        fs::remove_dir_all(root).unwrap();
    }
}
