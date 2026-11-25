use super::*;

#[test]
fn selected_gradle_capabilities_and_planning_use_the_explicit_executable() {
    let (root, binding) = fixture();
    let executable = root.join("custom-gradle");
    fs::write(&executable, "#!/bin/sh\nexit 0\n").unwrap();
    let selected = executable.to_str().unwrap();
    assert_eq!(
        selected_gradle(&root, &root, Some(selected)).unwrap(),
        executable
    );
    let capabilities = capabilities_selected(&binding, 1, "", "", Some(selected)).unwrap();
    assert!(capabilities.gradle);
    assert_eq!(capabilities.gradle_executable.as_deref(), Some(selected));
    let mut launch = request(&binding, "build");
    launch.configuration.build_tool = "gradle".into();
    // A selected path is a planning input, not a requirement that PATH contain Gradle.
    let sdk = root.join("jdk");
    fs::create_dir_all(sdk.join("bin")).unwrap();
    for tool in ["java", "javac"] {
        fs::write(sdk.join("bin").join(executable_name(tool)), "").unwrap();
    }
    launch.configuration.jdk_home = sdk.to_str().unwrap().into();
    let plan = invocation_selected_with_settings(
        &root,
        &launch,
        &[],
        false,
        None,
        None,
        InvocationSettings {
            build_tool_executable: Some(&executable),
            ..InvocationSettings::default()
        },
    )
    .unwrap();
    assert_eq!(plan[0].executable, executable);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn selected_gradle_refuses_invalid_selection_and_keeps_workspace_wrapper_priority() {
    let (root, binding) = fixture();
    for selected in [
        "relative/gradle",
        "/missing-selected-gradle",
        "/bad\0gradle",
    ] {
        assert!(selected_gradle(&root, &root, Some(selected)).is_err());
        assert!(
            !capabilities_selected(&binding, 1, "", "", Some(selected))
                .unwrap()
                .gradle
        );
    }
    #[cfg(unix)]
    {
        let wrapper = root.join("gradlew");
        fs::write(&wrapper, "#!/bin/sh\nexit 0\n").unwrap();
        assert_eq!(
            selected_gradle(&root, &root, Some("/missing-selected-gradle")).unwrap(),
            wrapper
        );
        assert!(
            capabilities_selected(&binding, 1, "", "", Some("/missing-selected-gradle"))
                .unwrap()
                .gradle
        );
    }
    fs::remove_dir_all(root).unwrap();
}
