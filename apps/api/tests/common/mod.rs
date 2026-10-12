//! Helpers that run the real `api` binary with an explicit environment.
//!
//! Every command starts from `env_clear()`, so a developer `.env` or shell
//! export never leaks into a test. Every wait has a time limit and kills the
//! process, so a server that starts by mistake cannot hang the suite.

use std::ffi::OsStr;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::{IpAddr, TcpListener};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const LIMIT: Duration = Duration::from_secs(15);

/// The `api` binary with an empty environment plus `vars`.
pub fn api<K, V>(vars: &[(K, V)]) -> Command
where
    K: AsRef<OsStr>,
    V: AsRef<OsStr>,
{
    let mut command = Command::new(env!("CARGO_BIN_EXE_api"));
    command
        .env_clear()
        // Windows needs SYSTEMROOT for sockets; it is not configuration (spec 0004 audit).
        .envs(std::env::var_os("SYSTEMROOT").map(|root| ("SYSTEMROOT", root)))
        .envs(vars.iter().map(|(name, value)| (name, value)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

/// A port that was free a moment ago, found by binding port 0.
pub fn free_port(host: IpAddr) -> u16 {
    TcpListener::bind((host, 0))
        .and_then(|listener| listener.local_addr())
        .expect("bind an ephemeral port")
        .port()
}

/// Whether this machine can bind the IPv6 loopback address.
pub fn ipv6_loopback_available() -> bool {
    TcpListener::bind("[::1]:0").is_ok()
}

pub struct Output {
    pub status: ExitStatus,
    pub stdout: String,
    pub stderr: String,
}

/// Runs a process that must exit on its own, killing it after `LIMIT`. A
/// stream that the command does not pipe is reported as empty.
pub fn run_to_exit(command: &mut Command) -> Output {
    let mut child = command.spawn().expect("spawn api");
    let stdout = child.stdout.take().map(collect);
    let stderr = child.stderr.take().map(collect);
    let deadline = Instant::now() + LIMIT;
    let status = loop {
        if let Some(status) = child.try_wait().expect("poll api") {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("api did not exit within {LIMIT:?}");
        }
        thread::sleep(Duration::from_millis(20));
    };
    let finish = |reader: Option<JoinHandle<Vec<u8>>>| {
        reader
            .map(|reader| text(reader.join().expect("output reader")))
            .unwrap_or_default()
    };
    Output {
        status,
        stdout: finish(stdout),
        stderr: finish(stderr),
    }
}

/// A running api process; it is killed when dropped.
pub struct Server {
    child: Child,
    lines: Receiver<String>,
    stderr: Option<JoinHandle<Vec<u8>>>,
    pub first_line: String,
}

impl Server {
    /// Starts the api and waits up to `LIMIT` for its first stdout line.
    pub fn start(command: &mut Command) -> Server {
        let mut child = command.spawn().expect("spawn api");
        let stdout = child.stdout.take().expect("api stdout");
        let stderr = child.stderr.take().expect("api stderr");
        let (sender, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        let mut server = Server {
            child,
            lines,
            stderr: Some(collect(stderr)),
            first_line: String::new(),
        };
        match server.lines.recv_timeout(LIMIT) {
            Ok(line) => server.first_line = line,
            Err(RecvTimeoutError::Timeout) => {
                panic!("api printed nothing within {LIMIT:?}")
            }
            Err(RecvTimeoutError::Disconnected) => {
                let (_, stderr) = server.stop();
                panic!("api exited before it started listening: {stderr}");
            }
        }
        server
    }

    /// Kills the server and returns all of its stdout and stderr.
    pub fn stop(&mut self) -> (String, String) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let mut stdout = self.first_line.clone();
        // The reader ends once the killed process closes its stdout.
        for line in self.lines.iter() {
            stdout.push('\n');
            stdout.push_str(&line);
        }
        let stderr = self
            .stderr
            .take()
            .map(|reader| text(reader.join().unwrap_or_default()))
            .unwrap_or_default();
        (stdout, stderr)
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A file in the system temp directory, removed when dropped.
pub struct TempFile(PathBuf);

impl TempFile {
    pub fn new(content: &[u8]) -> TempFile {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let name = format!(
            "foundation-api-config-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let path = std::env::temp_dir().join(name);
        fs::write(&path, content).expect("write temp file");
        TempFile(path)
    }

    pub fn path(&self) -> &str {
        self.0.to_str().expect("temp path is UTF-8")
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn collect(mut pipe: impl Read + Send + 'static) -> JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        bytes
    })
}

fn text(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).into_owned()
}
