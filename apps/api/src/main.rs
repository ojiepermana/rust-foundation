mod config;

use std::fs::File;
use std::io::{self, Read, Write};
use std::net::SocketAddr;
use std::path::Path;
use std::process::ExitCode;

use axum::Router;
use tokio::net::TcpListener;

use crate::config::{Config, MAX_SECRET_FILE_BYTES, NotUnicode};

/// Exit status for a configuration problem (EX_CONFIG from sysexits).
const EXIT_CONFIG: u8 = 78;

#[tokio::main]
async fn main() -> ExitCode {
    // Configuration is validated in full before any port is opened.
    let config = match Config::load(read_env, read_secret_file) {
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

/// Reads at most one byte more than the secret file limit, so an oversized
/// file (even `/dev/zero`) fails the size check without being loaded.
fn read_secret_file(path: &Path) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_SECRET_FILE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempFile(std::path::PathBuf);

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn temp_file(name: &str, content: &[u8]) -> TempFile {
        let path =
            std::env::temp_dir().join(format!("foundation-api-main-{}-{name}", std::process::id()));
        std::fs::write(&path, content).expect("write temp file");
        TempFile(path)
    }

    // covers: 0002 AC-4
    #[test]
    fn a_secret_file_within_the_limit_is_read_whole() {
        let content = vec![b'a'; MAX_SECRET_FILE_BYTES];
        let file = temp_file("exact", &content);
        assert_eq!(read_secret_file(&file.0).unwrap(), content);
    }

    // covers: 0002 AC-4
    #[test]
    fn a_larger_secret_file_is_read_only_one_byte_past_the_limit() {
        let file = temp_file("large", &vec![b'a'; 1024 * 1024]);
        assert_eq!(
            read_secret_file(&file.0).unwrap().len(),
            MAX_SECRET_FILE_BYTES + 1
        );
    }

    // covers: 0002 AC-4
    #[cfg(unix)]
    #[test]
    fn an_endless_device_is_read_only_one_byte_past_the_limit() {
        let bytes = read_secret_file(Path::new("/dev/zero")).unwrap();
        assert_eq!(bytes.len(), MAX_SECRET_FILE_BYTES + 1);
    }

    #[test]
    fn a_missing_secret_file_is_an_error() {
        let missing = std::env::temp_dir().join(format!(
            "foundation-api-main-{}-missing",
            std::process::id()
        ));
        assert!(read_secret_file(&missing).is_err());
    }
}
