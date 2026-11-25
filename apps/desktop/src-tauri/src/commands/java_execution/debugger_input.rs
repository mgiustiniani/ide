//! Bounded, atomic debugger commands. A busy debugger cannot hold Stop's child lock.

use std::process::ChildStdin;

#[cfg(unix)]
pub(super) fn prepare(input: &ChildStdin) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let fd = input.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err("Cannot configure nonblocking debugger input.".into());
    }
    Ok(())
}

#[cfg(not(unix))]
pub(super) fn prepare(_input: &ChildStdin) -> Result<(), String> {
    Err("Nonblocking debugger input is unavailable on this platform.".into())
}

#[cfg(unix)]
pub(super) fn send(input: &ChildStdin, command: &str) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let fd = input.as_raw_fd();
    let line = format!("{command}\n");
    let atomic_limit = unsafe { libc::fpathconf(fd, libc::_PC_PIPE_BUF) };
    if atomic_limit < 0 || line.len() > atomic_limit as usize {
        return Err("The debugger command exceeds its atomic input limit.".into());
    }
    // A single nonblocking write below PIPE_BUF either admits the complete command or refuses it.
    // Retrying an interrupted write is safe because EINTR indicates no transferred bytes.
    for _ in 0..3 {
        let written = unsafe { libc::write(fd, line.as_ptr().cast(), line.len()) };
        if written == line.len() as isize {
            return Ok(());
        }
        if written >= 0 {
            return Err("The debugger did not accept the complete command.".into());
        }
        match std::io::Error::last_os_error().kind() {
            std::io::ErrorKind::Interrupted => continue,
            std::io::ErrorKind::WouldBlock => return Err(
                "The debugger command queue is full. Wait for the current command or press Stop."
                    .into(),
            ),
            _ => {
                return Err(
                    "Cannot write to the debugger; its command input may have closed.".into(),
                )
            }
        }
    }
    Err("Debugger input was interrupted. Retry the command.".into())
}

#[cfg(not(unix))]
pub(super) fn send(_input: &ChildStdin, _command: &str) -> Result<(), String> {
    Err("Nonblocking debugger input is unavailable on this platform.".into())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::Read;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    struct OwnedChild(Child);
    impl Drop for OwnedChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn full_input_refuses_a_command_without_waiting_for_the_reader() {
        let mut child = OwnedChild(
            Command::new("/bin/sleep")
                .arg("30")
                .stdin(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let input = child.0.stdin.take().unwrap();
        prepare(&input).unwrap();
        let began = Instant::now();
        let mut accepted = 0;
        // Small commands remain atomic even on a platform with the minimum POSIX pipe limit.
        let command = format!("print {}", "x".repeat(400));
        let refused = loop {
            match send(&input, &command) {
                Ok(()) => {
                    accepted += 1;
                    assert!(accepted < 10_000);
                }
                Err(error) => break error,
            }
        };
        assert!(accepted > 0);
        assert!(refused.contains("queue is full"));
        assert!(began.elapsed() < Duration::from_secs(2));
        child.0.kill().unwrap();
        child.0.wait().unwrap();
    }

    #[test]
    fn input_preserves_one_literal_command_and_refuses_oversized_atomic_writes() {
        let mut child = OwnedChild(
            Command::new("/bin/cat")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let input = child.0.stdin.take().unwrap();
        prepare(&input).unwrap();
        send(&input, "print \"literal π 🧪\"").unwrap();
        assert!(send(&input, &"x".repeat(2 * 1024 * 1024))
            .unwrap_err()
            .contains("atomic input limit"));
        drop(input);
        let mut observed = String::new();
        child
            .0
            .stdout
            .take()
            .unwrap()
            .read_to_string(&mut observed)
            .unwrap();
        assert_eq!(observed, "print \"literal π 🧪\"\n");
        assert!(child.0.wait().unwrap().success());
    }
}
