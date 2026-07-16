pub mod app_config;
pub mod commands;
pub mod workspace;
pub mod xcom2_setup_cli;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(commands::java_language::JavaLanguageServiceState::default())
        .manage(commands::refactorkit_daemon::RefactorKitDaemonState::default())
        .manage(commands::refactorkit_daemon::SavedSnapshotSemanticState::default())
        .manage(commands::xcom2_setup_monitor::Xcom2SetupMonitorState::default())
        .manage(commands::xcom2_setup_transaction::Xcom2SetupTransactionState::default())
        .invoke_handler(tauri::generate_handler![
            commands::file_tree::list_directory,
            commands::file_tree::create_file,
            commands::file_tree::create_directory,
            commands::file_tree::delete_path,
            commands::file_tree::rename_path,
            commands::clipboard::read_clipboard_text,
            commands::editor::read_file,
            commands::editor::write_file,
            commands::terminal::execute_command,
            commands::terminal::resize_pty,
            commands::refactorkit::get_refactorkit_status,
            commands::refactorkit_daemon::get_refactorkit_capabilities,
            commands::refactorkit_daemon::preview_refactorkit_external_java_import,
            commands::refactorkit_daemon::apply_refactorkit_plan,
            commands::refactorkit_daemon::discard_refactorkit_plan,
            commands::refactorkit_daemon::rollback_refactorkit_transaction,
            commands::refactorkit_daemon::shutdown_refactorkit_daemon,
            commands::refactorkit_daemon::start_refactorkit_saved_snapshot_semantic_session,
            commands::refactorkit_daemon::stop_refactorkit_saved_snapshot_semantic_session,
            commands::refactorkit_daemon::search_refactorkit_saved_snapshot_symbols,
            commands::refactorkit_daemon::resolve_refactorkit_saved_snapshot_definition,
            commands::refactorkit::run_refactorkit_scan,
            commands::refactorkit::run_refactorkit_diagnostics,
            commands::refactorkit::run_refactorkit_symbols,
            commands::refactorkit::run_refactorkit_definition,
            commands::refactorkit::run_refactorkit_references,
            commands::java_language::get_java_language_service_status,
            commands::java_language::start_java_language_service,
            commands::java_language::stop_java_language_service,
            commands::java_language::restart_java_language_service,
            commands::java_language::poll_java_language_service_events,
            commands::java_language::open_java_language_document,
            commands::java_language::change_java_language_document,
            commands::java_language::save_java_language_document,
            commands::java_language::close_java_language_document,
            commands::java_language::request_java_completion,
            commands::java_language::request_java_hover,
            commands::java_language::request_java_signature_help,
            commands::java_language::cancel_java_semantic_request,
            commands::workspace_registry::ensure_current_workspace,
            commands::workspace_registry::list_workspaces,
            commands::workspace_registry::switch_workspace,
            commands::xcom2_module_configuration::read_xcom2_module_configuration,
            commands::xcom2_module_evidence::scan_xcom2_module_evidence,
            commands::xcom2_setup_monitor::get_xcom2_setup_monitor_snapshot,
            commands::xcom2_setup_monitor::refresh_xcom2_setup_monitor_snapshot,
            commands::xcom2_setup_monitor::poll_xcom2_setup_monitor_events,
            commands::xcom2_setup_transaction::prepare_xcom2_setup_transaction,
            commands::xcom2_setup_transaction::apply_xcom2_setup_transaction,
            commands::xcom2_setup_transaction::get_xcom2_setup_transaction,
            commands::xcom2_setup_transaction::list_xcom2_setup_transactions,
            commands::xcom2_setup_transaction::cancel_xcom2_setup_transaction,
            commands::xcom2_setup_transaction::rollback_xcom2_setup_transaction,
            commands::xcom2_setup_transaction::recover_xcom2_setup_transaction,
            commands::xcom2_setup_transaction::poll_xcom2_setup_transaction_events,
            commands::ai_agent::get_pi_agent_settings,
            commands::ai_agent::update_pi_agent_settings,
            commands::ai_agent::get_pi_agent_status,
            commands::ai_agent::install_pi_agent,
            commands::ai_agent::send_pi_agent_prompt,
            commands::ai_agent::get_pi_agent_session_messages,
            commands::ai_agent::list_pi_agent_commands,
            commands::ai_agent::list_agent_runs,
            commands::ai_agent::get_agent_run_trace,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle
                .state::<commands::java_language::JavaLanguageServiceState>()
                .shutdown_all();
            app_handle
                .state::<commands::refactorkit_daemon::RefactorKitDaemonState>()
                .shutdown_all();
            app_handle
                .state::<commands::refactorkit_daemon::SavedSnapshotSemanticState>()
                .shutdown_all();
            commands::xcom2_setup_transaction::flush_xcom2_setup_transactions(
                &app_handle
                    .state::<commands::xcom2_setup_transaction::Xcom2SetupTransactionState>(),
            );
        }
    });
}
