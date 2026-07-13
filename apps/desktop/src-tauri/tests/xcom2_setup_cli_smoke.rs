use std::process::Command;

#[test]
#[ignore = "read-only live Steam/SDK prepare; creates only the production native journal"]
fn live_prepare_cli_is_json_and_never_applies() {
    let binary = env!("CARGO_BIN_EXE_xcom2-setup");
    let output = Command::new(binary)
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .env("IDE_WORKSPACE_ROOT", "/home/paperboy/workspace/ide")
        .args(["prepare", "--json"])
        .output()
        .expect("live prepare CLI must start");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let transaction = &json["transaction"];
    assert_eq!(json["ok"], true);
    assert_eq!(transaction["operationCount"], 15);
    assert_eq!(transaction["executable"], true);
    assert_eq!(transaction["state"], "prepared");
    assert_eq!(transaction["journal"]["exists"], true);
    let serialized = String::from_utf8(output.stdout).unwrap();
    assert!(!serialized.contains("generatedContent"));
    assert!(!serialized.contains("backup"));
    assert!(!serialized.contains("installRoot"));
}
