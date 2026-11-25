//! Application bytes travel separately from the debugger's command stream.
use super::{executable_name, Invocation, LaunchFile};
use super::launch_settings::{java8_launcher, java_runtime_has_module};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub(super) const CHUNK_LIMIT: usize = 4096;
const MAX_SEQUENCE: u64 = 9_007_199_254_740_990;
const POLL: Duration = Duration::from_millis(10);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub state: &'static str,
    pub accepted_bytes: u64,
    pub next_sequence: u64,
    pub reason: Option<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Acknowledgement {
    pub sequence: u64,
    pub accepted_bytes: usize,
    pub input: Snapshot,
}

struct Previous {
    sequence: u64,
    fingerprint: [u8; 32],
    acknowledgement: Acknowledgement,
}

struct State {
    snapshot: Snapshot,
    writer: Option<TcpStream>,
    stopped: bool,
    previous: Option<Previous>,
}

pub(super) struct Bridge {
    source: LaunchFile,
    option: String,
    state: Arc<Mutex<State>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

pub(super) struct Completion<'a>(&'a Bridge);
impl Drop for Completion<'_> {
    fn drop(&mut self) {
        self.0.finish();
    }
}

pub(super) fn available(home: &Path) -> bool {
    if !home.join("bin").join(executable_name("jar")).is_file() {
        return false;
    }
    if java8_launcher(home) {
        let library = format!("{}instrument{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX);
        let lib = home.join("jre/lib");
        return home.join("jre/bin").join(&library).is_file()
            || lib.join(&library).is_file()
            || fs::read_dir(lib).is_ok_and(|entries| {
                entries.filter_map(Result::ok).any(|entry| entry.path().join(&library).is_file())
            });
    }
    java_runtime_has_module(home, "java.instrument", 9)
}

impl Bridge {
    pub(super) fn create(home: &Path) -> Result<Self, String> {
        if !available(home) {
            return Err(
                "Application input requires a full JDK 8 or later with Java instrumentation and jar."
                    .into(),
            );
        }
        let source = LaunchFile::create(
            "IdeApplicationInput.java",
            include_bytes!("IdeApplicationInput.java"),
        )?;
        let directory = source
            .path
            .parent()
            .ok_or("Application input storage is unavailable.")?;
        let jar = directory.join("input.jar");
        let jar_path = jar
            .to_str()
            .ok_or("Application input requires UTF-8 temporary paths.")?;
        if jar_path.contains('=') {
            return Err("Application input temporary paths cannot contain an equals sign.".into());
        }
        // Own the directory before writing additional files, so every error cleans it up.
        let state = Arc::new(Mutex::new(State {
            snapshot: Snapshot {
                state: "waiting",
                accepted_bytes: 0,
                next_sequence: 1,
                reason: None,
            },
            writer: None,
            stopped: false,
            previous: None,
        }));
        let mut bridge = Self {
            option: format!(
                "-javaagent:{jar_path}={}",
                directory.join("input.properties").display()
            ),
            source,
            state: state.clone(),
            worker: Mutex::new(None),
        };
        let directory = bridge.source.path.parent().unwrap();
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Cannot open the application input listener.")?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "Cannot configure application input.")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Cannot identify application input.")?
            .port();
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).map_err(|_| "Cannot identify application input.")?;
        let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        private_file(
            &directory.join("input.properties"),
            format!("port={port}\ntoken={token}\n").as_bytes(),
        )?;
        private_file(
            &directory.join("MANIFEST.MF"),
            b"Manifest-Version: 1.0\nPremain-Class: dev.ide.runtime.IdeApplicationInput\n\n",
        )?;
        fs::create_dir(directory.join("classes"))
            .map_err(|_| "Cannot prepare the application input agent.")?;
        *bridge
            .worker
            .get_mut()
            .map_err(|_| "Application input is unavailable.")? = Some(
            thread::Builder::new()
                .name("java-application-input".into())
                .spawn(move || listen(listener, token.as_bytes(), &state))
                .map_err(|_| "Cannot start the application input listener.")?,
        );
        Ok(bridge)
    }

    pub(super) fn option(&self) -> &str {
        &self.option
    }

    pub(super) fn completion(&self) -> Completion<'_> {
        Completion(self)
    }

    /// These invocations run through the same owned/cancellable executor as project tools.
    pub(super) fn compilation(&self, home: &Path) -> Vec<Invocation> {
        let directory = self.source.path.parent().unwrap();
        let mut compiler_arguments = if java8_launcher(home) {
            vec!["-source".into(), "8".into(), "-target".into(), "8".into()]
        } else {
            vec!["--release".into(), "8".into(), "-Xlint:-options".into()]
        };
        compiler_arguments.extend([
            "-proc:none".into(),
            "-d".into(),
            directory.join("classes").to_string_lossy().into_owned(),
            self.source.path.to_string_lossy().into_owned(),
        ]);
        [
            ("javac", compiler_arguments),
            (
                "jar",
                vec![
                    "cfm".into(),
                    directory.join("input.jar").to_string_lossy().into_owned(),
                    directory.join("MANIFEST.MF").to_string_lossy().into_owned(),
                    "-C".into(),
                    directory.join("classes").to_string_lossy().into_owned(),
                    ".".into(),
                ],
            ),
        ]
        .into_iter()
        .map(|(tool, arguments)| Invocation {
            directory: directory.to_owned(),
            executable: home.join("bin").join(executable_name(tool)),
            arguments,
            interactive: false,
            java_home: home.to_owned(),
            launch_file: None,
            discovery: None,
            coverage: None,
            auxiliary_files: vec![],
            profile_path: None,
            test_report_path: None,
        })
        .collect()
    }

    pub(super) fn snapshot(&self) -> Result<Snapshot, String> {
        self.state
            .lock()
            .map(|state| state.snapshot.clone())
            .map_err(|_| "Application input is unavailable.".into())
    }

    /// A retry repeats only its acknowledgement, never its bytes. Partial writes are explicit.
    pub(super) fn send(
        &self,
        sequence: u64,
        bytes: Option<&[u8]>,
        current: impl FnOnce() -> bool,
    ) -> Result<Acknowledgement, String> {
        if sequence == 0
            || sequence > MAX_SEQUENCE
            || bytes.is_some_and(|bytes| bytes.is_empty() || bytes.len() > CHUNK_LIMIT)
        {
            return Err("Invalid application input sequence or chunk size.".into());
        }
        let mut digest = Sha256::new();
        digest.update([u8::from(bytes.is_none())]);
        digest.update(bytes.unwrap_or_default());
        let fingerprint: [u8; 32] = digest.finalize().into();
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Application input is unavailable.")?;
        if !current() {
            return Err("The application input session is obsolete.".into());
        }
        if let Some(previous) = &state.previous {
            if previous.sequence == sequence {
                return if previous.fingerprint == fingerprint {
                    Ok(previous.acknowledgement.clone())
                } else {
                    Err("An application input retry changed its contents.".into())
                };
            }
        }
        if state.snapshot.next_sequence != sequence {
            return Err("The application input sequence is obsolete.".into());
        }
        if state.stopped || state.snapshot.state != "open" {
            return Err("Application input is not open.".into());
        }
        let writer = state
            .writer
            .as_mut()
            .ok_or("Application input is not connected.")?;
        let accepted_bytes = if let Some(bytes) = bytes {
            match writer.write(bytes) {
                Ok(count) => count,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) =>
                {
                    0
                }
                Err(_) => {
                    close(
                        &mut state,
                        "closed",
                        Some("The application input connection closed."),
                    );
                    return Err("The application input connection closed.".into());
                }
            }
        } else {
            writer
                .shutdown(Shutdown::Write)
                .map_err(|_| "Cannot close application input.")?;
            state.snapshot.state = "closed";
            state.snapshot.reason = Some("End of input was sent.");
            0
        };
        state.snapshot.accepted_bytes = state
            .snapshot
            .accepted_bytes
            .saturating_add(accepted_bytes as u64)
            .min(MAX_SEQUENCE);
        state.snapshot.next_sequence += 1;
        let acknowledgement = Acknowledgement {
            sequence,
            accepted_bytes,
            input: state.snapshot.clone(),
        };
        state.previous = Some(Previous {
            sequence,
            fingerprint,
            acknowledgement: acknowledgement.clone(),
        });
        Ok(acknowledgement)
    }

    pub(super) fn finish(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.stopped = true;
            let waiting = state.snapshot.state == "waiting";
            let reason = if waiting {
                Some("The application did not connect to its input channel.")
            } else if state.snapshot.state == "open" {
                Some("The application session ended.")
            } else {
                state.snapshot.reason
            };
            close(
                &mut state,
                if waiting { "unavailable" } else { "closed" },
                reason,
            );
        }
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
        if let Some(directory) = self.source.path.parent() {
            let _ = fs::remove_dir_all(directory);
        }
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.finish();
        if let Some(directory) = self.source.path.parent() {
            let _ = fs::remove_dir_all(directory);
        }
    }
}

fn private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .and_then(|mut file| file.write_all(bytes))
        .map_err(|_| "Cannot prepare private application input settings.".into())
}

fn close(state: &mut State, status: &'static str, reason: Option<&'static str>) {
    if let Some(writer) = state.writer.take() {
        let _ = writer.shutdown(Shutdown::Both);
    }
    state.snapshot.state = status;
    state.snapshot.reason = reason;
}

fn active(state: &Mutex<State>) -> bool {
    state
        .lock()
        .is_ok_and(|state| !state.stopped && matches!(state.snapshot.state, "waiting" | "open"))
}

fn listen(listener: TcpListener, token: &[u8], state: &Mutex<State>) {
    while active(state) {
        match listener.accept() {
            Ok((mut stream, address)) if address.ip().is_loopback() => {
                if stream.set_nonblocking(true).is_err() {
                    continue;
                }
                let deadline = Instant::now() + Duration::from_secs(2);
                let mut received = [0_u8; 32];
                let mut offset = 0;
                while offset < received.len() && Instant::now() < deadline && active(state) {
                    match stream.read(&mut received[offset..]) {
                        Ok(0) => break,
                        Ok(count) => offset += count,
                        Err(error)
                            if matches!(
                                error.kind(),
                                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                            ) =>
                        {
                            thread::sleep(POLL)
                        }
                        Err(_) => break,
                    }
                }
                let difference = received
                    .iter()
                    .zip(token)
                    .fold(0_u8, |diff, (left, right)| diff | (left ^ right));
                if offset != 32 || difference != 0 {
                    continue;
                }
                let Ok(mut current) = state.lock() else {
                    return;
                };
                if current.stopped || current.snapshot.state != "waiting" {
                    return;
                }
                let Ok(writer) = stream.try_clone() else {
                    continue;
                };
                if stream.write(&[1]).ok() != Some(1) {
                    continue;
                }
                current.writer = Some(writer);
                current.snapshot.state = "open";
                drop(current);
                // The client sends no bytes after authentication. EOF also detects System.in.close().
                while active(state) {
                    match stream.read(&mut [0_u8; 1]) {
                        Err(error)
                            if matches!(
                                error.kind(),
                                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                            ) =>
                        {
                            thread::sleep(POLL)
                        }
                        _ => {
                            if let Ok(mut current) = state.lock() {
                                if current.snapshot.state == "open" {
                                    close(
                                        &mut current,
                                        "closed",
                                        Some("The application closed its input connection."),
                                    );
                                }
                            }
                            return;
                        }
                    }
                }
                return;
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(POLL),
            Err(_) => {
                if let Ok(mut current) = state.lock() {
                    close(
                        &mut current,
                        "unavailable",
                        Some("The application input listener failed."),
                    );
                }
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests;
