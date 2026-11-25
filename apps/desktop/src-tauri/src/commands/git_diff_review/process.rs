//! Bounded local Git subprocesses. Never run workspace-configured diff or monitor programs.
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

pub(super) const TIMEOUT: Duration = Duration::from_secs(5);
const MAX_STDOUT: usize = 1024 * 1024;
const MAX_STDERR: usize = 64 * 1024;
const UNAVAILABLE: &str = "Git changes are unavailable for this workspace.";

fn terminate(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub(super) fn git(root: &Path, args: &[&str], deadline: Instant) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .args([
            "--no-pager",
            "--no-optional-locks",
            "--literal-pathspecs",
            "-c",
            "core.fsmonitor=false",
        ])
        .args(args)
        .current_dir(root);
    // A shell's repository overrides are not authority for the selected IDE workspace.
    for name in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        command.env_remove(name);
    }
    let bytes = capture(&mut command, deadline)?;
    String::from_utf8(bytes).map_err(|_| "Git output is not valid UTF-8.".to_owned())
}

enum Event {
    Data(bool, Vec<u8>),
    Closed,
    Failed,
}
fn reader(
    mut pipe: impl Read + Send + 'static,
    stdout: bool,
    sender: std::sync::mpsc::SyncSender<Event>,
) {
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            let event = match pipe.read(&mut buffer) {
                Ok(0) => Event::Closed,
                Ok(count) => Event::Data(stdout, buffer[..count].to_vec()),
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => Event::Failed,
            };
            let terminal = matches!(event, Event::Closed | Event::Failed);
            if sender.send(event).is_err() || terminal {
                break;
            }
        }
    });
}

pub(crate) fn capture(command: &mut Command, deadline: Instant) -> Result<Vec<u8>, String> {
    let output = capture_output(command, deadline)?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(UNAVAILABLE.to_owned())
    }
}

pub(crate) struct GitCommandOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
}

pub(crate) fn capture_output(
    command: &mut Command,
    deadline: Instant,
) -> Result<GitCommandOutput, String> {
    capture_with_stdin(command, deadline, Stdio::null())
}

/// A bounded Git operation can consume an already captured regular input file.
pub(crate) fn capture_output_with_input(
    command: &mut Command,
    deadline: Instant,
    input: std::fs::File,
) -> Result<GitCommandOutput, String> {
    capture_with_stdin(command, deadline, Stdio::from(input))
}

fn capture_with_stdin(
    command: &mut Command,
    deadline: Instant,
    input: Stdio,
) -> Result<GitCommandOutput, String> {
    if Instant::now() >= deadline {
        return Err("Git review timed out.".into());
    }
    command
        .stdin(input)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|_| UNAVAILABLE.to_owned())?;
    let (sender, receiver) = sync_channel(4);
    reader(child.stdout.take().unwrap(), true, sender.clone());
    reader(child.stderr.take().unwrap(), false, sender);
    let mut finished = false;
    let result = (|| {
        let mut output = Vec::new();
        let mut stderr_bytes = 0usize;
        let mut closed = 0;
        loop {
            let status = child.try_wait().map_err(|_| UNAVAILABLE.to_owned())?;
            if closed == 2 {
                if let Some(status) = status {
                    finished = true;
                    return Ok(GitCommandOutput {
                        status,
                        stdout: output,
                    });
                }
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("Git review timed out.".into());
            }
            match receiver.recv_timeout(remaining.min(Duration::from_millis(20))) {
                Ok(Event::Data(true, bytes)) => {
                    if output.len() + bytes.len() > MAX_STDOUT {
                        return Err("Git changes exceed the review output limit.".into());
                    }
                    output.extend(bytes);
                }
                Ok(Event::Data(false, bytes)) => {
                    stderr_bytes += bytes.len();
                    if stderr_bytes > MAX_STDERR {
                        return Err("Git changes exceed the review output limit.".into());
                    }
                }
                Ok(Event::Closed) => closed += 1,
                Ok(Event::Failed) => return Err(UNAVAILABLE.to_owned()),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) if closed == 2 => {
                    thread::sleep(remaining.min(Duration::from_millis(20)));
                }
                Err(_) => return Err(UNAVAILABLE.to_owned()),
            }
        }
    })();
    if result.is_err() && !finished {
        terminate(&mut child);
    }
    // No unbounded reader joins: channel closure also releases blocked senders on refusal.
    drop(receiver);
    result
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn rejects_output_floods_on_either_pipe() {
        for script in ["yes review", "yes review >&2"] {
            let started = Instant::now();
            let result = capture(Command::new("sh").args(["-c", script]), started + TIMEOUT);
            assert_eq!(
                result.unwrap_err(),
                "Git changes exceed the review output limit."
            );
            assert!(started.elapsed() < TIMEOUT);
        }
    }

    #[test]
    fn deadline_applies_when_descendant_keeps_output_pipes_open() {
        let started = Instant::now();
        // The shell exits successfully while its child retains the captured pipes.
        let result = capture(
            Command::new("sh").args(["-c", "sleep 10 & exit 0"]),
            started + Duration::from_millis(150),
        );
        assert_eq!(result.unwrap_err(), "Git review timed out.");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn refuses_nonzero_exit_and_does_not_expose_stderr() {
        let result = capture(
            Command::new("sh").args(["-c", "printf private-detail >&2; exit 1"]),
            Instant::now() + TIMEOUT,
        );
        assert_eq!(result.unwrap_err(), UNAVAILABLE);
    }

    #[test]
    fn expired_deadline_never_starts_the_command() {
        let mut command = Command::new("this-command-does-not-exist");
        assert_eq!(
            capture(&mut command, Instant::now()).unwrap_err(),
            "Git review timed out."
        );
    }
}
