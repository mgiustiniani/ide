use super::*;

struct Fixture(LaunchFile);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0.path.parent().unwrap());
    }
}
fn bridge() -> (Fixture, Bridge) {
    // Only SDK metadata is simulated here; authentication and IO use real sockets.
    let fixture = Fixture(LaunchFile::create("release", b"JAVA_VERSION=\"21.0.11\"\n").unwrap());
    let home = fixture.0.path.parent().unwrap();
    fs::create_dir(home.join("bin")).unwrap();
    fs::create_dir(home.join("jmods")).unwrap();
    fs::write(home.join("bin").join(executable_name("jar")), b"").unwrap();
    fs::write(home.join("jmods/java.instrument.jmod"), b"").unwrap();
    let bridge = Bridge::create(home).unwrap();
    (fixture, bridge)
}

#[test]
fn java8_input_requires_the_instrumentation_library() {
    let fixture = Fixture(LaunchFile::create("release", b"JAVA_VERSION=\"1.8.0_512\"\n").unwrap());
    let home = fixture.0.path.parent().unwrap();
    fs::create_dir(home.join("bin")).unwrap();
    fs::write(home.join("bin").join(executable_name("jar")), b"").unwrap();
    assert!(!available(home));

    let directory = home.join(if cfg!(windows) { "jre/bin" } else { "jre/lib/arch" });
    fs::create_dir_all(&directory).unwrap();
    let library = format!("{}instrument{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX);
    fs::write(directory.join(library), b"").unwrap();
    assert!(available(home));
}

#[test]
fn modular_input_uses_the_runtime_image_without_jmods() {
    let fixture = Fixture(LaunchFile::create("release", b"JAVA_VERSION=\"27\"\nMODULES=\"java.base java.instrument\"\n").unwrap());
    let home = fixture.0.path.parent().unwrap();
    fs::create_dir(home.join("bin")).unwrap();
    fs::write(home.join("bin").join(executable_name("jar")), b"").unwrap();
    assert!(!available(home));
    fs::create_dir(home.join("lib")).unwrap();
    fs::write(home.join("lib/modules"), b"").unwrap();
    assert!(available(home));
    fs::write(home.join("release"), b"JAVA_VERSION=\"27\"\nMODULES=\"java.base\"\n").unwrap();
    assert!(!available(home));
}

fn settings(bridge: &Bridge) -> (u16, String) {
    let text = fs::read_to_string(
        bridge
            .source
            .path
            .parent()
            .unwrap()
            .join("input.properties"),
    )
    .unwrap();
    (
        text.lines()
            .find_map(|line| line.strip_prefix("port="))
            .unwrap()
            .parse()
            .unwrap(),
        text.lines()
            .find_map(|line| line.strip_prefix("token="))
            .unwrap()
            .into(),
    )
}
fn connect(bridge: &Bridge) -> TcpStream {
    let (port, token) = settings(bridge);
    let mut client = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    // A partial authentication header must not be treated as a rejected request.
    client.write_all(&token.as_bytes()[..7]).unwrap();
    thread::sleep(POLL * 2);
    client.write_all(&token.as_bytes()[7..]).unwrap();
    let mut acknowledgement = [0];
    client.read_exact(&mut acknowledgement).unwrap();
    assert_eq!(acknowledgement, [1]);
    client
}

#[test]
fn application_input_authentication_exact_bytes_retries_and_eof() {
    let (_fixture, bridge) = bridge();
    assert_eq!(bridge.snapshot().unwrap().state, "waiting");
    assert!(bridge.send(1, Some(b"premature"), || true).is_err());
    let (port, _) = settings(&bridge);
    let mut intruder = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).unwrap();
    intruder
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    intruder.write_all(&[b'x'; 32]).unwrap();
    assert_eq!(intruder.read(&mut [0]).unwrap(), 0);
    assert_eq!(bridge.snapshot().unwrap().state, "waiting");
    let mut client = connect(&bridge);
    let bytes = "café 𐐀\n\ncont\n$(false); 'quoted'\0".as_bytes();
    let sent = bridge.send(1, Some(bytes), || true).unwrap();
    assert_eq!(sent.accepted_bytes, bytes.len());
    assert_eq!(
        bridge.send(1, Some(bytes), || true).unwrap().accepted_bytes,
        bytes.len()
    );
    assert!(bridge.send(1, Some(b"changed"), || true).is_err());
    assert!(bridge.send(3, Some(b"skipped"), || true).is_err());
    assert!(bridge.send(2, Some(b"obsolete"), || false).is_err());
    assert_eq!(
        bridge.snapshot().unwrap().accepted_bytes,
        bytes.len() as u64
    );
    let eof = bridge.send(2, None, || true).unwrap();
    assert_eq!(eof.input.state, "closed");
    assert_eq!(bridge.send(2, None, || true).unwrap().sequence, 2);
    assert!(bridge.send(3, Some(b"late"), || true).is_err());
    let mut received = Vec::new();
    client.read_to_end(&mut received).unwrap();
    assert_eq!(received, bytes);
    bridge.finish();
    assert_eq!(bridge.send(2, None, || true).unwrap().sequence, 2);
}

#[test]
fn application_input_disconnect_and_unconnected_stop_never_report_open() {
    let (_fixture, bridge) = bridge();
    let client = connect(&bridge);
    drop(client);
    let deadline = Instant::now() + Duration::from_secs(3);
    while bridge.snapshot().unwrap().state == "open" && Instant::now() < deadline {
        thread::sleep(POLL);
    }
    assert_eq!(bridge.snapshot().unwrap().state, "closed");
    assert!(bridge.send(1, Some(b"late"), || true).is_err());
    let (_fixture, waiting) = self::bridge();
    let (port, _) = settings(&waiting);
    let _incomplete_client = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).unwrap();
    thread::sleep(POLL * 2);
    let start = Instant::now();
    waiting.finish();
    assert!(start.elapsed() < Duration::from_secs(1));
    assert_eq!(waiting.snapshot().unwrap().state, "unavailable");
    assert!(waiting.send(1, Some(b"late"), || true).is_err());
}

#[cfg(unix)]
#[test]
fn application_input_backpressure_is_nonblocking_and_reports_only_accepted_bytes() {
    use std::os::fd::AsRawFd;
    let (_fixture, bridge) = bridge();
    let client = connect(&bridge);
    let size: libc::c_int = 4096;
    let state = bridge.state.lock().unwrap();
    let writer = state.writer.as_ref().unwrap();
    for (socket, option) in [(writer, libc::SO_SNDBUF), (&client, libc::SO_RCVBUF)] {
        assert_eq!(
            unsafe {
                libc::setsockopt(
                    socket.as_raw_fd(),
                    libc::SOL_SOCKET,
                    option,
                    &size as *const _ as *const libc::c_void,
                    std::mem::size_of_val(&size) as libc::socklen_t,
                )
            },
            0
        );
    }
    drop(state);
    let start = Instant::now();
    let mut accepted = 0;
    let mut blocked = false;
    for sequence in 1..=1024 {
        let result = bridge
            .send(sequence, Some(&[b'x'; CHUNK_LIMIT]), || true)
            .unwrap();
        accepted += result.accepted_bytes;
        if result.accepted_bytes == 0 {
            assert_eq!(
                bridge
                    .send(sequence, Some(&[b'x'; CHUNK_LIMIT]), || true)
                    .unwrap()
                    .accepted_bytes,
                0
            );
            blocked = true;
            break;
        }
    }
    assert!(
        blocked,
        "The fixture must actually fill the socket send buffer."
    );
    assert!(start.elapsed() < Duration::from_secs(2));
    assert_eq!(bridge.snapshot().unwrap().accepted_bytes, accepted as u64);
    bridge.finish();
}

#[test]
fn application_input_limits_private_settings_and_cleanup() {
    let (_fixture, bridge) = bridge();
    let directory = bridge.source.path.parent().unwrap().to_owned();
    let (_, token) = settings(&bridge);
    assert!(!bridge.option().contains(&token));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        for file in [
            "input.properties",
            "MANIFEST.MF",
            "IdeApplicationInput.java",
        ] {
            assert_eq!(
                fs::metadata(directory.join(file))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
    for sequence in [0, MAX_SEQUENCE + 1] {
        assert!(bridge.send(sequence, Some(b"x"), || true).is_err());
    }
    assert!(bridge.send(1, Some(b""), || true).is_err());
    assert!(bridge
        .send(1, Some(&[0; CHUNK_LIMIT + 1]), || true)
        .is_err());
    drop(bridge);
    assert!(!directory.exists());
}
