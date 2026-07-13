use std::process::ExitCode;

use ide_desktop::commands::xcom2_setup_transaction::Xcom2SetupOperationalService;
use ide_desktop::xcom2_setup_cli::{
    execute, invalid_failure, parse_args, ExecutionPayload, ListSuccess, TransactionSuccess,
    EXIT_BLOCKED, EXIT_CONFLICT, EXIT_INTERNAL, EXIT_INVALID,
};

fn main() -> ExitCode {
    let request = match parse_args(std::env::args().skip(1)) {
        Ok(request) => request,
        Err(message) => {
            print_json(&invalid_failure(message));
            eprintln!("invalid command");
            return ExitCode::from(EXIT_INVALID as u8);
        }
    };
    let engine = Xcom2SetupOperationalService::default();
    match execute(&engine, &request) {
        Ok(result) => {
            match result.payload {
                ExecutionPayload::Transaction(transaction) => print_json(&TransactionSuccess {
                    ok: true,
                    transaction: *transaction,
                }),
                ExecutionPayload::List(transactions) => print_json(&ListSuccess {
                    ok: true,
                    transactions,
                }),
            }
            match result.exit_code {
                EXIT_BLOCKED => eprintln!("operation blocked"),
                EXIT_CONFLICT => eprintln!("transaction conflict"),
                _ => {}
            }
            ExitCode::from(result.exit_code as u8)
        }
        Err((exit_code, failure)) => {
            print_json(&failure);
            eprintln!(
                "{}",
                match exit_code {
                    EXIT_INVALID => "invalid transaction request",
                    EXIT_BLOCKED => "operation blocked",
                    EXIT_CONFLICT => "transaction conflict",
                    _ => "internal transaction failure",
                }
            );
            ExitCode::from(exit_code.min(EXIT_INTERNAL) as u8)
        }
    }
}

fn print_json(value: &impl serde::Serialize) {
    match serde_json::to_string(value) {
        Ok(json) => println!("{json}"),
        Err(_) => {
            let _ = std::io::Write::write_all(
                &mut std::io::stdout(),
                b"{\"ok\":false,\"error\":{\"code\":\"internal\",\"message\":\"JSON serialization failed safely\"}}\n",
            );
        }
    }
}
