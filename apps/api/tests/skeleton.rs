//! Runs the real `api` binary and talks raw HTTP to it, so the skeleton is
//! proven without adding an HTTP client dependency. This is the only test that
//! uses the default port 3000.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

const ADDRESS: &str = "127.0.0.1:3000";
const STARTUP_LIMIT: Duration = Duration::from_secs(15);

/// Kills the server when the test ends, even when an assertion fails.
struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// The api binary with an empty environment plus the minimal valid
/// configuration, so it listens on the default address.
fn api_command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_api"));
    command.env_clear().env("APP_ENV", "development").env(
        "DATABASE_URL",
        "postgres://app:placeholder@127.0.0.1:5432/app_test",
    );
    command
}

fn start_server() -> (Server, String) {
    assert!(
        TcpListener::bind(ADDRESS).is_ok(),
        "port {ADDRESS} is already in use; stop that process before running this test"
    );
    let mut server = Server(
        api_command()
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn api binary"),
    );
    let mut first_line = String::new();
    BufReader::new(server.0.stdout.take().expect("api stdout"))
        .read_line(&mut first_line)
        .expect("read api stdout");
    let address: SocketAddr = ADDRESS.parse().unwrap();
    let deadline = Instant::now() + STARTUP_LIMIT;
    while TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_err() {
        assert!(
            Instant::now() < deadline,
            "api did not accept connections on {ADDRESS}"
        );
        sleep(Duration::from_millis(100));
    }
    (server, first_line)
}

fn status_line(method: &str, path: &str) -> String {
    let mut stream = TcpStream::connect(ADDRESS).expect("connect to api");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: {ADDRESS}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .expect("send request");
    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");
    response.lines().next().unwrap_or_default().to_owned()
}

// One test owns the fixed port, so the scenarios run in sequence inside it.
#[test]
fn skeleton_listens_on_loopback_answers_404_and_refuses_a_second_bind() {
    let (server, first_line) = start_server();

    // covers: AC-7, 0002 AC-2
    assert_eq!(
        first_line.trim_end(),
        "api listening on http://127.0.0.1:3000"
    );

    // covers: AC-7
    for (method, path) in [
        ("GET", "/"),
        ("GET", "/random/path-41907"),
        ("POST", "/random/path-41907"),
        ("POST", "/api/anything"),
    ] {
        assert_eq!(
            status_line(method, path),
            "HTTP/1.1 404 Not Found",
            "{method} {path} should be 404 on an empty router"
        );
    }

    // covers: AC-7, 0002 AC-2
    let second = api_command().output().expect("run second api instance");
    assert!(
        !second.status.success(),
        "a second instance must fail while the port is taken"
    );
    let stderr = String::from_utf8_lossy(&second.stderr);
    assert!(
        stderr.contains("cannot bind 127.0.0.1:3000"),
        "the failure should name the address, got: {stderr}"
    );
    assert!(
        second.stdout.is_empty(),
        "a failed instance must not claim it is listening"
    );

    drop(server);
}
