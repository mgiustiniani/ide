use std::path::PathBuf;

use ide_desktop::commands::editor::read_file_in_root;
use serde_json::json;

fn active_style_javaspec_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/javaspec")
        .canonicalize()
        .expect("javaspec fixture root must exist")
}

#[test]
fn reads_readme_and_license_with_the_production_response_contract() {
    let root = active_style_javaspec_root();

    let readme = read_file_in_root(&root, "README.md").expect("README read must complete");
    assert_eq!(
        readme,
        json!({
            "path": root.join("README.md").to_string_lossy(),
            "content": "# JavaSpec fixture\n\nNative file-open integration fixture.\n",
            "language": "markdown"
        })
    );

    let license = read_file_in_root(&root, "LICENSE").expect("LICENSE read must complete");
    assert_eq!(license["content"], "Test fixture license text.\n");
    assert_eq!(license["language"], "plaintext");
    assert_eq!(
        license["path"],
        root.join("LICENSE").to_string_lossy().as_ref()
    );
}
