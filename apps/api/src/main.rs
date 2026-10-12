mod config;

use std::io::Write;
use std::net::SocketAddr;
use std::path::Path;
use std::process::ExitCode;

use axum::Router;
use tokio::net::TcpListener;

use crate::config::{Config, NotUnicode};

/// Exit status for a configuration problem (EX_CONFIG from sysexits).
const EXIT_CONFIG: u8 = 78;

#[tokio::main]
async fn main() -> ExitCode {
    // Configuration is validated in full before any port is opened.
    let config = match Config::load(read_env, |path: &Path| std::fs::read(path)) {
        Ok(config) => config,
        Err(errors) => {
            // writeln! instead of eprintln!, which panics when stderr is closed.
            let mut stderr = std::io::stderr().lock();
            let _ = writeln!(stderr, "configuration error:");
            for error in &errors {
                let _ = writeln!(stderr, "  {error}");
            }
            return ExitCode::from(EXIT_CONFIG);
        }
    };

    let address = SocketAddr::new(config.host, config.port);
    let listener = TcpListener::bind(address)
        .await
        .unwrap_or_else(|error| panic!("cannot bind {address}: {error}"));
    let bound = listener
        .local_addr()
        .unwrap_or_else(|error| panic!("cannot read the address bound for {address}: {error}"));
    println!("api listening on http://{bound}");
    axum::serve(listener, Router::new())
        .await
        .unwrap_or_else(|error| panic!("server on {bound} stopped: {error}"));
    ExitCode::SUCCESS
}

fn read_env(name: &str) -> Result<Option<String>, NotUnicode> {
    std::env::var_os(name)
        .map(|value| value.into_string().map_err(|_| NotUnicode))
        .transpose()
}
