use serde::Serialize;

use crate::commands::xcom2_setup_transaction::{
    SetupTransaction, SetupTransactionExport, TransactionState, Xcom2SetupOperationalService,
};

pub const EXIT_OK: i32 = 0;
pub const EXIT_INVALID: i32 = 2;
pub const EXIT_BLOCKED: i32 = 3;
pub const EXIT_CONFLICT: i32 = 4;
pub const EXIT_INTERNAL: i32 = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    Prepare,
    Status {
        transaction_id: String,
    },
    List,
    Apply {
        transaction_id: String,
        approval_digest: String,
    },
    RestoreVanilla {
        transaction_id: String,
    },
    Recover {
        transaction_id: String,
        strategy: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliRequest {
    pub command: CliCommand,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliFailure {
    pub ok: bool,
    pub error: CliErrorBody,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliErrorBody {
    pub code: &'static str,
    pub message: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionSuccess {
    pub ok: bool,
    pub transaction: SetupTransactionExport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSuccess {
    pub ok: bool,
    pub transactions: Vec<SetupTransactionExport>,
}

pub trait OperationalEngine {
    fn prepare(&self) -> Result<SetupTransaction, String>;
    fn status(&self, transaction_id: &str) -> Result<SetupTransaction, String>;
    fn list(&self) -> Result<Vec<SetupTransaction>, String>;
    fn apply(
        &self,
        transaction_id: &str,
        approval_digest: &str,
    ) -> Result<SetupTransaction, String>;
    fn restore_vanilla(&self, transaction_id: &str) -> Result<SetupTransaction, String>;
    fn recover(&self, transaction_id: &str, strategy: &str) -> Result<SetupTransaction, String>;
    fn journal_exists(&self, transaction_id: &str) -> Result<bool, String>;
}

impl OperationalEngine for Xcom2SetupOperationalService {
    fn prepare(&self) -> Result<SetupTransaction, String> {
        self.prepare()
    }
    fn status(&self, transaction_id: &str) -> Result<SetupTransaction, String> {
        self.status(transaction_id)
    }
    fn list(&self) -> Result<Vec<SetupTransaction>, String> {
        self.list()
    }
    fn apply(
        &self,
        transaction_id: &str,
        approval_digest: &str,
    ) -> Result<SetupTransaction, String> {
        self.apply(transaction_id, approval_digest)
    }
    fn restore_vanilla(&self, transaction_id: &str) -> Result<SetupTransaction, String> {
        self.restore_vanilla(transaction_id)
    }
    fn recover(&self, transaction_id: &str, strategy: &str) -> Result<SetupTransaction, String> {
        self.recover(transaction_id, strategy)
    }
    fn journal_exists(&self, transaction_id: &str) -> Result<bool, String> {
        self.journal_exists(transaction_id)
    }
}

pub enum ExecutionPayload {
    Transaction(Box<SetupTransactionExport>),
    List(Vec<SetupTransactionExport>),
}

pub struct ExecutionResult {
    pub exit_code: i32,
    pub payload: ExecutionPayload,
}

pub fn parse_args<I, S>(args: I) -> Result<CliRequest, &'static str>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut args = args.into_iter().map(Into::into);
    let command = args.next().ok_or("missing command")?;
    let mut json = false;
    let mut transaction_id = None;
    let mut approval_digest = None;
    let mut strategy = None;
    let mut confirmation = false;

    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--json" if !json => json = true,
            "--transaction-id" if transaction_id.is_none() => {
                transaction_id = Some(args.next().ok_or("--transaction-id requires a value")?);
            }
            "--approval-digest" if approval_digest.is_none() => {
                approval_digest = Some(args.next().ok_or("--approval-digest requires a value")?);
            }
            "--strategy" if strategy.is_none() => {
                strategy = Some(args.next().ok_or("--strategy requires a value")?);
            }
            "--confirm-restore-vanilla" if !confirmation => confirmation = true,
            _ => return Err("unknown, duplicate, or unsafe argument"),
        }
    }
    if !json {
        return Err("--json is required");
    }

    let no_id = || transaction_id.is_none() && approval_digest.is_none() && strategy.is_none();
    let parsed = match command.as_str() {
        "prepare" if no_id() && !confirmation => CliCommand::Prepare,
        "list" if no_id() && !confirmation => CliCommand::List,
        "status" if approval_digest.is_none() && strategy.is_none() && !confirmation => {
            CliCommand::Status {
                transaction_id: checked_id(transaction_id.as_deref())?,
            }
        }
        "apply" if strategy.is_none() && !confirmation => CliCommand::Apply {
            transaction_id: checked_id(transaction_id.as_deref())?,
            approval_digest: checked_digest(approval_digest.as_deref())?,
        },
        "restore-vanilla" if approval_digest.is_none() && strategy.is_none() && confirmation => {
            CliCommand::RestoreVanilla {
                transaction_id: checked_id(transaction_id.as_deref())?,
            }
        }
        "recover" if approval_digest.is_none() && !confirmation => CliCommand::Recover {
            transaction_id: checked_id(transaction_id.as_deref())?,
            strategy: checked_strategy(strategy.as_deref())?.to_string(),
        },
        "restore-vanilla" => return Err("restore requires --confirm-restore-vanilla"),
        "prepare" | "status" | "list" | "apply" | "recover" => {
            return Err("arguments do not match the command contract")
        }
        _ => return Err("unknown command"),
    };
    Ok(CliRequest { command: parsed })
}

fn checked_id(value: Option<&str>) -> Result<String, &'static str> {
    let value = value.ok_or("--transaction-id is required")?;
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("transaction ID is invalid");
    }
    Ok(value.to_string())
}

fn checked_digest(value: Option<&str>) -> Result<String, &'static str> {
    let value = value.ok_or("--approval-digest is required")?;
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("approval digest must be exactly 64 hexadecimal characters");
    }
    Ok(value.to_ascii_lowercase())
}

fn checked_strategy(value: Option<&str>) -> Result<&str, &'static str> {
    match value {
        Some(strategy @ ("resume-rollback" | "retry-rollback" | "verify-journal")) => Ok(strategy),
        _ => Err("recovery strategy is not allowlisted"),
    }
}

pub fn execute<E: OperationalEngine>(
    engine: &E,
    request: &CliRequest,
) -> Result<ExecutionResult, (i32, CliFailure)> {
    let result = match &request.command {
        CliCommand::Prepare => engine.prepare().map(Box::new).map(Either::One),
        CliCommand::Status { transaction_id } => {
            engine.status(transaction_id).map(Box::new).map(Either::One)
        }
        CliCommand::List => engine.list().map(Either::Many),
        CliCommand::Apply {
            transaction_id,
            approval_digest,
        } => engine
            .apply(transaction_id, approval_digest)
            .map(Box::new)
            .map(Either::One),
        CliCommand::RestoreVanilla { transaction_id } => engine
            .restore_vanilla(transaction_id)
            .map(Box::new)
            .map(Either::One),
        CliCommand::Recover {
            transaction_id,
            strategy,
        } => engine
            .recover(transaction_id, strategy)
            .map(Box::new)
            .map(Either::One),
    };

    match result {
        Ok(Either::One(transaction)) => {
            let journal_exists = engine
                .journal_exists(&transaction.transaction_id)
                .map_err(|error| classified_failure(&error))?;
            let exit_code = state_exit_code(&transaction.state, transaction.executable);
            Ok(ExecutionResult {
                exit_code,
                payload: ExecutionPayload::Transaction(Box::new(
                    transaction.export_safe(journal_exists),
                )),
            })
        }
        Ok(Either::Many(transactions)) => {
            let mut exported = Vec::with_capacity(transactions.len());
            for transaction in transactions {
                let exists = engine
                    .journal_exists(&transaction.transaction_id)
                    .map_err(|error| classified_failure(&error))?;
                exported.push(transaction.export_safe(exists));
            }
            Ok(ExecutionResult {
                exit_code: EXIT_OK,
                payload: ExecutionPayload::List(exported),
            })
        }
        Err(error) => Err(classified_failure(&error)),
    }
}

enum Either {
    One(Box<SetupTransaction>),
    Many(Vec<SetupTransaction>),
}

fn state_exit_code(state: &TransactionState, executable: bool) -> i32 {
    match state {
        TransactionState::RollbackConflict => EXIT_CONFLICT,
        TransactionState::Waiting | TransactionState::RecoveryRequired => EXIT_BLOCKED,
        TransactionState::Prepared if !executable => EXIT_BLOCKED,
        _ => EXIT_OK,
    }
}

fn classified_failure(error: &str) -> (i32, CliFailure) {
    let lower = error.to_ascii_lowercase();
    let (exit_code, code, message) = if lower.contains("conflict") {
        (
            EXIT_CONFLICT,
            "conflict",
            "The transaction has a filesystem conflict",
        )
    } else if lower.contains("digest")
        || lower.contains("unknown setup transaction")
        || lower.contains("unsupported xcom 2 recovery strategy")
        || lower.contains("not applicable")
        || lower.contains("current state")
        || lower.contains("no applied mutations")
    {
        (
            EXIT_INVALID,
            "invalid",
            "The transaction request was rejected",
        )
    } else if lower.contains("blocked")
        || lower.contains("incomplete")
        || lower.contains("unavailable")
        || lower.contains("not found")
        || lower.contains("changed after approval")
    {
        (
            EXIT_BLOCKED,
            "blocked",
            "The transaction is blocked by current machine evidence",
        )
    } else {
        (
            EXIT_INTERNAL,
            "internal",
            "The native transaction service failed safely",
        )
    };
    (
        exit_code,
        CliFailure {
            ok: false,
            error: CliErrorBody { code, message },
        },
    )
}

pub fn invalid_failure(message: &'static str) -> CliFailure {
    CliFailure {
        ok: false,
        error: CliErrorBody {
            code: "invalid",
            message,
        },
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    #[derive(Default)]
    struct RecordingEngine(RefCell<Vec<String>>);

    impl OperationalEngine for RecordingEngine {
        fn prepare(&self) -> Result<SetupTransaction, String> {
            self.0.borrow_mut().push("prepare".into());
            Err("blocked".into())
        }
        fn status(&self, transaction_id: &str) -> Result<SetupTransaction, String> {
            self.0.borrow_mut().push(format!("status:{transaction_id}"));
            Err("blocked".into())
        }
        fn list(&self) -> Result<Vec<SetupTransaction>, String> {
            self.0.borrow_mut().push("list".into());
            Err("blocked".into())
        }
        fn apply(&self, transaction_id: &str, digest: &str) -> Result<SetupTransaction, String> {
            self.0
                .borrow_mut()
                .push(format!("apply:{transaction_id}:{digest}"));
            Err("blocked".into())
        }
        fn restore_vanilla(&self, transaction_id: &str) -> Result<SetupTransaction, String> {
            self.0
                .borrow_mut()
                .push(format!("restore:{transaction_id}"));
            Err("blocked".into())
        }
        fn recover(
            &self,
            transaction_id: &str,
            strategy: &str,
        ) -> Result<SetupTransaction, String> {
            self.0
                .borrow_mut()
                .push(format!("recover:{transaction_id}:{strategy}"));
            Err("blocked".into())
        }
        fn journal_exists(&self, _transaction_id: &str) -> Result<bool, String> {
            panic!("failed engine calls must not inspect a journal")
        }
    }

    #[test]
    fn parser_accepts_only_the_fixed_operational_surface() {
        assert_eq!(
            parse_args(["prepare", "--json"]).unwrap().command,
            CliCommand::Prepare
        );
        assert_eq!(
            parse_args([
                "restore-vanilla",
                "--transaction-id",
                "abc-123",
                "--confirm-restore-vanilla",
                "--json"
            ])
            .unwrap()
            .command,
            CliCommand::RestoreVanilla {
                transaction_id: "abc-123".into()
            }
        );
        assert!(parse_args(["restore-vanilla", "--transaction-id", "abc", "--json"]).is_err());
        assert!(parse_args(["prepare", "--root", "/tmp/sdk", "--json"]).is_err());
        assert!(parse_args([
            "apply",
            "--transaction-id",
            "../journal",
            "--approval-digest",
            &"a".repeat(64),
            "--json"
        ])
        .is_err());
    }

    #[test]
    fn parser_requires_full_digest_and_allowlisted_recovery() {
        let digest = "A".repeat(64);
        assert_eq!(
            parse_args([
                "apply",
                "--json",
                "--transaction-id",
                "abc-123",
                "--approval-digest",
                &digest
            ])
            .unwrap()
            .command,
            CliCommand::Apply {
                transaction_id: "abc-123".into(),
                approval_digest: digest.to_ascii_lowercase()
            }
        );
        assert!(parse_args([
            "apply",
            "--transaction-id",
            "abc",
            "--approval-digest",
            "abcd",
            "--json"
        ])
        .is_err());
        assert!(parse_args([
            "recover",
            "--transaction-id",
            "abc",
            "--strategy",
            "force",
            "--json"
        ])
        .is_err());
    }

    #[test]
    fn dispatch_maps_fixed_commands_without_synthesizing_mutation_inputs() {
        let engine = RecordingEngine::default();
        let digest = "a".repeat(64);
        let requests = [
            CliRequest {
                command: CliCommand::Prepare,
            },
            CliRequest {
                command: CliCommand::Status {
                    transaction_id: "tx-1".into(),
                },
            },
            CliRequest {
                command: CliCommand::List,
            },
            CliRequest {
                command: CliCommand::Apply {
                    transaction_id: "tx-1".into(),
                    approval_digest: digest.clone(),
                },
            },
            CliRequest {
                command: CliCommand::RestoreVanilla {
                    transaction_id: "tx-1".into(),
                },
            },
            CliRequest {
                command: CliCommand::Recover {
                    transaction_id: "tx-1".into(),
                    strategy: "verify-journal".into(),
                },
            },
        ];
        for request in &requests {
            assert!(execute(&engine, request).is_err());
        }
        assert_eq!(
            *engine.0.borrow(),
            vec![
                "prepare",
                "status:tx-1",
                "list",
                &format!("apply:tx-1:{digest}"),
                "restore:tx-1",
                "recover:tx-1:verify-journal",
            ]
        );
    }
}
