use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::workspace::workspace_root;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_COMMAND_LEN: usize = 4096;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

/// Execute a command directly in the workspace root.
///
/// The command line is parsed into an executable plus arguments and is never
/// passed to `sh -c`/`cmd /C`. Shell metacharacters are rejected with a clear
/// policy error; stdout/stderr are capped and long-running processes are killed.
#[tauri::command]
pub fn execute_command(command: String) -> Result<Value, String> {
    let root = workspace_root()?;
    let args = parse_command_line(&command)?;

    if args.is_empty() {
        return Err("Command is empty".to_string());
    }

    validate_program_name(&args[0])?;

    let output = run_command(&args, &root)?;

    serde_json::to_value(serde_json::json!({
        "stdout": output.stdout,
        "stderr": output.stderr,
        "success": output.success,
        "code": output.code,
        "timedOut": output.timed_out,
        "stdoutTruncated": output.stdout_truncated,
        "stderrTruncated": output.stderr_truncated
    }))
    .map_err(|e| format!("Serialization error: {e}"))
}

struct CommandOutput {
    stdout: String,
    stderr: String,
    success: bool,
    code: i32,
    timed_out: bool,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

fn run_command(args: &[String], cwd: &std::path::Path) -> Result<CommandOutput, String> {
    let mut child = Command::new(&args[0])
        .args(&args[1..])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Command execution failed for '{}': {e}", args[0]))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot capture command stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot capture command stderr".to_string())?;

    let stdout_thread = thread::spawn(move || read_capped(stdout, MAX_OUTPUT_BYTES));
    let stderr_thread = thread::spawn(move || read_capped(stderr, MAX_OUTPUT_BYTES));

    let deadline = Instant::now() + COMMAND_TIMEOUT;
    let mut timed_out = false;

    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Cannot poll command status: {e}"))?
        {
            break status;
        }

        if Instant::now() >= deadline {
            timed_out = true;
            child
                .kill()
                .map_err(|e| format!("Cannot kill timed-out command: {e}"))?;
            break child
                .wait()
                .map_err(|e| format!("Cannot wait for timed-out command: {e}"))?;
        }

        thread::sleep(Duration::from_millis(25));
    };

    let (stdout_bytes, stdout_truncated) = stdout_thread
        .join()
        .map_err(|_| "Cannot join stdout reader".to_string())??;
    let (stderr_bytes, stderr_truncated) = stderr_thread
        .join()
        .map_err(|_| "Cannot join stderr reader".to_string())??;

    let mut stderr_text = String::from_utf8_lossy(&stderr_bytes).to_string();
    if timed_out {
        if !stderr_text.is_empty() && !stderr_text.ends_with('\n') {
            stderr_text.push('\n');
        }
        stderr_text.push_str(&format!(
            "Command timed out after {} seconds",
            COMMAND_TIMEOUT.as_secs()
        ));
    }

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&stdout_bytes).to_string(),
        stderr: stderr_text,
        success: status.success() && !timed_out,
        code: if timed_out {
            124
        } else {
            status.code().unwrap_or(1)
        },
        timed_out,
        stdout_truncated,
        stderr_truncated,
    })
}

fn read_capped(mut reader: impl Read, cap: usize) -> Result<(Vec<u8>, bool), String> {
    let mut output = Vec::with_capacity(cap.min(8192));
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Cannot read command output: {e}"))?;
        if read == 0 {
            break;
        }

        let remaining = cap.saturating_sub(output.len());
        if remaining > 0 {
            let to_copy = remaining.min(read);
            output.extend_from_slice(&buffer[..to_copy]);
        }

        if read > remaining {
            truncated = true;
        }
    }

    Ok((output, truncated))
}

fn validate_program_name(program: &str) -> Result<(), String> {
    if program.contains('/') || program.contains('\\') {
        return Err(
            "Command policy rejected executable paths; run a program from PATH without '/' or '\\'"
                .to_string(),
        );
    }

    if program == "sh" || program == "bash" || program == "zsh" || program == "cmd" {
        return Err("Command policy rejected interactive/raw shells".to_string());
    }

    Ok(())
}

fn parse_command_line(command: &str) -> Result<Vec<String>, String> {
    if command.len() > MAX_COMMAND_LEN {
        return Err(format!(
            "Command is too long: {} bytes exceeds {MAX_COMMAND_LEN}",
            command.len()
        ));
    }

    let mut args = Vec::new();
    let mut arg = String::new();
    let mut chars = command.chars().peekable();
    let mut quote = Quote::None;
    let mut in_arg = false;

    while let Some(ch) = chars.next() {
        if ch == '\0' || (ch.is_control() && ch != '\t') {
            return Err("Command contains unsupported control characters".to_string());
        }

        match quote {
            Quote::None => match ch {
                '\'' => {
                    quote = Quote::Single;
                    in_arg = true;
                }
                '"' => {
                    quote = Quote::Double;
                    in_arg = true;
                }
                '\\' => {
                    let next = chars
                        .next()
                        .ok_or_else(|| "Command ends with an escape character".to_string())?;
                    arg.push(next);
                    in_arg = true;
                }
                ch if ch.is_whitespace() => {
                    if in_arg {
                        args.push(std::mem::take(&mut arg));
                        in_arg = false;
                    }
                }
                '|' | '&' | ';' | '<' | '>' | '(' | ')' | '`' | '$' => {
                    return Err(format!(
                        "Command policy rejected shell metacharacter '{ch}'. Pipes, redirection and command chaining are not supported."
                    ));
                }
                _ => {
                    arg.push(ch);
                    in_arg = true;
                }
            },
            Quote::Single => {
                if ch == '\'' {
                    quote = Quote::None;
                } else {
                    arg.push(ch);
                }
            }
            Quote::Double => match ch {
                '"' => quote = Quote::None,
                '\\' => {
                    let next = chars
                        .next()
                        .ok_or_else(|| "Command ends with an escape character".to_string())?;
                    arg.push(next);
                }
                _ => arg.push(ch),
            },
        }
    }

    match quote {
        Quote::None => {}
        Quote::Single | Quote::Double => {
            return Err("Command contains an unterminated quote".to_string())
        }
    }

    if in_arg {
        args.push(arg);
    }

    Ok(args)
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum Quote {
    None,
    Single,
    Double,
}

/// Resize a pseudo-terminal (PTY) session.
///
/// In a full terminal implementation, this would communicate with
/// an active PTY session to adjust its dimensions.
/// For now, it serves as a placeholder that acknowledges the resize
/// request.
#[tauri::command]
pub async fn resize_pty(cols: u32, rows: u32) -> Result<Value, String> {
    serde_json::to_value(serde_json::json!({
        "success": true,
        "cols": cols,
        "rows": rows
    }))
    .map_err(|e| format!("Serialization error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_parser_rejects_shell_chaining() {
        assert!(parse_command_line("echo ok && rm -rf /").is_err());
    }

    #[test]
    fn command_parser_preserves_quoted_argument() {
        let args = parse_command_line("echo 'hello world'").unwrap();
        assert_eq!(args, vec!["echo", "hello world"]);
    }

    #[test]
    fn command_policy_rejects_shells_and_paths() {
        assert!(validate_program_name("sh").is_err());
        assert!(validate_program_name("./script.sh").is_err());
        assert!(validate_program_name("cargo").is_ok());
    }
}
