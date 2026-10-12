//! Process tests for configuration loading (spec 0002): the real binary, an
//! explicit environment, and free ports only. Port 3000 belongs to skeleton.rs.

mod common;

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

use common::{Server, TempFile, api, free_port, ipv6_loopback_available, run_to_exit};

const MARKER: &str = "pw-marker-c0ffee42";
const LOOPBACK: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);

fn database_url() -> String {
    format!("postgres://app:{MARKER}@127.0.0.1:5432/app_test")
}

fn tls_database_url() -> String {
    format!("postgres://app:{MARKER}@db.internal:5432/app?sslmode=verify-full")
}

/// Expected stderr for a configuration failure.
fn report(lines: &[&str]) -> String {
    let mut text = String::from("configuration error:\n");
    for line in lines {
        text.push_str("  ");
        text.push_str(line);
        text.push('\n');
    }
    text
}

/// Runs a start that must fail with status 78, an empty stdout, no panic, and
/// no trace of the password marker.
fn expect_config_failure(vars: &[(&str, &str)]) -> String {
    let output = run_to_exit(&mut api(vars));
    assert_eq!(output.status.code(), Some(78), "stderr: {}", output.stderr);
    assert_eq!(
        output.stdout, "",
        "a failed start must print nothing on stdout"
    );
    assert!(!output.stderr.contains("panicked"), "{}", output.stderr);
    assert!(
        !output.stderr.contains(MARKER),
        "stderr copied a secret: {}",
        output.stderr
    );
    output.stderr
}

fn assert_accepts_connections(address: SocketAddr) {
    TcpStream::connect_timeout(&address, Duration::from_secs(5))
        .unwrap_or_else(|error| panic!("cannot connect to {address}: {error}"));
}

// covers: 0002 AC-1
#[test]
fn every_problem_is_reported_in_one_start_with_status_78() {
    let stderr = expect_config_failure(&[
        ("APP_ENV", "prod"),
        ("APP_PORT", "0"),
        ("CORS_ALLOWED_ORIGINS", "*"),
    ]);
    assert_eq!(
        stderr,
        report(&[
            "APP_ENV: must be one of development, test, staging, production",
            "APP_PORT: must be an integer from 1 to 65535",
            "DATABASE_URL: is required",
            "CORS_ALLOWED_ORIGINS: * is not allowed",
        ])
    );
}

// covers: 0002 AC-1
#[test]
fn an_empty_environment_names_the_required_variables() {
    let no_vars: [(&str, &str); 0] = [];
    let output = run_to_exit(&mut api(&no_vars));
    assert_eq!(output.status.code(), Some(78));
    assert_eq!(output.stdout, "");
    assert_eq!(
        output.stderr,
        report(&["APP_ENV: is required", "DATABASE_URL: is required"])
    );
}

// covers: 0002 AC-1
#[test]
fn a_configuration_error_stops_before_any_port_is_opened() {
    // Holding the port proves the binary never tries to bind it: a bind attempt
    // would panic with "cannot bind" instead of exiting 78.
    let held = TcpListener::bind((LOOPBACK, 0)).expect("hold a port");
    let port = held.local_addr().unwrap().port().to_string();
    let stderr = expect_config_failure(&[
        ("APP_ENV", "development"),
        ("APP_PORT", &port),
        ("DATABASE_URL", "mysql://app@db/app"),
    ]);
    assert_eq!(
        stderr,
        report(&[
            "DATABASE_URL: must be a postgres:// or postgresql:// URL with user, host, and database name"
        ])
    );
}

// covers: 0002 AC-2
#[test]
fn listens_on_the_configured_host_and_port() {
    let port = free_port(LOOPBACK);
    let url = database_url();
    let mut server = Server::start(&mut api(&[
        ("APP_ENV", "development"),
        ("APP_HOST", "127.0.0.1"),
        ("APP_PORT", &port.to_string()),
        ("DATABASE_URL", &url),
    ]));
    assert_eq!(
        server.first_line,
        format!("api listening on http://127.0.0.1:{port}")
    );
    assert_accepts_connections(SocketAddr::new(LOOPBACK, port));
    let (stdout, stderr) = server.stop();
    // covers: 0002 AC-4
    assert!(!stdout.contains(MARKER), "stdout copied a secret: {stdout}");
    assert!(!stderr.contains(MARKER), "stderr copied a secret: {stderr}");
}

// covers: 0002 AC-2
#[test]
fn an_ipv6_address_is_printed_in_brackets() {
    if !ipv6_loopback_available() {
        eprintln!("skipped: ::1 cannot be bound on this machine");
        return;
    }
    let loopback = IpAddr::V6(Ipv6Addr::LOCALHOST);
    let port = free_port(loopback);
    let url = database_url();
    let server = Server::start(&mut api(&[
        ("APP_ENV", "test"),
        ("APP_HOST", "::1"),
        ("APP_PORT", &port.to_string()),
        ("DATABASE_URL", &url),
    ]));
    assert_eq!(
        server.first_line,
        format!("api listening on http://[::1]:{port}")
    );
    assert_accepts_connections(SocketAddr::new(loopback, port));
}

// covers: 0002 AC-2
#[test]
fn a_taken_port_still_fails_with_cannot_bind() {
    let held = TcpListener::bind((LOOPBACK, 0)).expect("hold a port");
    let port = held.local_addr().unwrap().port();
    let url = database_url();
    let output = run_to_exit(&mut api(&[
        ("APP_ENV", "development"),
        ("APP_PORT", &port.to_string()),
        ("DATABASE_URL", &url),
    ]));
    assert!(!output.status.success());
    assert_ne!(output.status.code(), Some(78));
    assert_eq!(output.stdout, "");
    assert!(
        output
            .stderr
            .contains(&format!("cannot bind 127.0.0.1:{port}")),
        "{}",
        output.stderr
    );
    assert!(!output.stderr.contains(MARKER), "{}", output.stderr);
}

// covers: 0002 AC-3, 0002 AC-4
#[test]
fn production_rejects_every_unsafe_value_and_development_accepts_them() {
    let runtime = format!("postgres://app:{MARKER}@db/app");
    let migrator = format!("postgres://migrator:{MARKER}@db/app?sslmode=disable");
    let unsafe_values = [
        ("DATABASE_URL", runtime.as_str()),
        ("DATABASE_MIGRATOR_URL", migrator.as_str()),
        ("COOKIE_SECURE", "false"),
        ("CORS_ALLOWED_ORIGINS", "http://app.example.com"),
        ("DEV_SEED_ENABLED", "true"),
        ("WEB_API_BASE_URL", "http://api.example.com"),
    ];
    for app_env in ["staging", "production"] {
        let mut vars = vec![("APP_ENV", app_env)];
        vars.extend(unsafe_values);
        assert_eq!(
            expect_config_failure(&vars),
            report(&[
                "DATABASE_URL: sslmode must be require, verify-ca, or verify-full when APP_ENV is staging or production",
                "DATABASE_MIGRATOR_URL: sslmode must be require, verify-ca, or verify-full when APP_ENV is staging or production",
                "COOKIE_SECURE: must be true when APP_ENV is staging or production",
                "CORS_ALLOWED_ORIGINS: must use https:// origins when APP_ENV is staging or production",
                "DEV_SEED_ENABLED: must be false when APP_ENV is staging or production",
                "WEB_API_BASE_URL: must be a path or an https:// URL when APP_ENV is staging or production",
            ]),
            "{app_env}"
        );
    }

    let port = free_port(LOOPBACK).to_string();
    let mut vars = vec![("APP_ENV", "development"), ("APP_PORT", port.as_str())];
    vars.extend(unsafe_values);
    let mut server = Server::start(&mut api(&vars));
    assert_eq!(
        server.first_line,
        format!("api listening on http://127.0.0.1:{port}")
    );
    let (stdout, stderr) = server.stop();
    assert!(!stdout.contains(MARKER) && !stderr.contains(MARKER));
}

// covers: 0002 AC-4
#[test]
fn invalid_secret_values_are_never_printed() {
    for (name, value) in [
        (
            "DATABASE_URL",
            format!("postgresql://app:{MARKER}@db/app#x"),
        ),
        ("DATABASE_URL", format!("postgres://app:{MARKER} @db/app")),
        (
            "DATABASE_MIGRATOR_URL",
            format!("postgres://app:{MARKER}@db/app?ssl-mode=require"),
        ),
    ] {
        let tls = tls_database_url();
        let mut vars = vec![("APP_ENV", "production")];
        if name != "DATABASE_URL" {
            vars.push(("DATABASE_URL", &tls));
        }
        vars.push((name, &value));
        let stderr = expect_config_failure(&vars);
        assert!(stderr.starts_with(&format!("configuration error:\n  {name}: ")));
    }
    let tls = tls_database_url();
    let stderr = expect_config_failure(&[
        ("APP_ENV", "production"),
        ("DATABASE_URL", &tls),
        ("DATABASE_URL_FILE", "/run/secrets/database_url"),
    ]);
    assert_eq!(
        stderr,
        report(&["DATABASE_URL: set either DATABASE_URL or DATABASE_URL_FILE, not both"])
    );
}

// covers: 0002 AC-4
#[test]
fn a_secret_file_supplies_the_database_url() {
    let file = TempFile::new(format!("{}\n", tls_database_url()).as_bytes());
    let port = free_port(LOOPBACK);
    let mut server = Server::start(&mut api(&[
        ("APP_ENV", "production"),
        ("APP_PORT", &port.to_string()),
        ("DATABASE_URL_FILE", file.path()),
        ("DATABASE_MIGRATOR_URL_FILE", file.path()),
    ]));
    assert_eq!(
        server.first_line,
        format!("api listening on http://127.0.0.1:{port}")
    );
    let (stdout, stderr) = server.stop();
    assert!(!stdout.contains(MARKER) && !stderr.contains(MARKER));
}

// covers: 0002 AC-4
#[test]
fn secret_file_problems_name_the_variable_and_the_path() {
    let missing = TempFile::new(b"");
    let missing_path = format!("{}-missing", missing.path());
    let stderr = expect_config_failure(&[
        ("APP_ENV", "development"),
        ("DATABASE_URL_FILE", &missing_path),
    ]);
    assert_eq!(
        stderr,
        report(&[&format!(
            "DATABASE_URL_FILE: cannot read file \"{missing_path}\""
        )])
    );

    let empty = TempFile::new(b"\n");
    let stderr = expect_config_failure(&[
        ("APP_ENV", "development"),
        ("DATABASE_URL_FILE", empty.path()),
    ]);
    assert_eq!(stderr, report(&["DATABASE_URL_FILE: file is empty"]));

    let mut large = format!("postgres://app:{MARKER}@db/app?x=").into_bytes();
    large.resize(8 * 1024 + 1, b'a');
    let large = TempFile::new(&large);
    let stderr = expect_config_failure(&[
        ("APP_ENV", "development"),
        ("DATABASE_URL_FILE", large.path()),
    ]);
    assert_eq!(
        stderr,
        report(&["DATABASE_URL_FILE: file is larger than 8 KiB"])
    );

    let mut binary = MARKER.as_bytes().to_vec();
    binary.push(0xff);
    let binary = TempFile::new(&binary);
    let stderr = expect_config_failure(&[
        ("APP_ENV", "development"),
        ("DATABASE_URL_FILE", binary.path()),
    ]);
    assert_eq!(
        stderr,
        report(&["DATABASE_URL_FILE: file is not valid UTF-8"])
    );

    // A content problem names the main variable and never the content.
    let wrong = TempFile::new(format!("mysql://app:{MARKER}@db/app\n").as_bytes());
    let stderr = expect_config_failure(&[
        ("APP_ENV", "development"),
        ("DATABASE_URL_FILE", wrong.path()),
    ]);
    assert_eq!(
        stderr,
        report(&[
            "DATABASE_URL: must be a postgres:// or postgresql:// URL with user, host, and database name"
        ])
    );
}

// covers: 0002 AC-1
#[cfg(unix)]
#[test]
fn a_closed_stderr_still_exits_78_without_panicking() {
    // The read end is closed before the start, so every stderr write fails.
    // eprintln! would panic (status 101); the report must ignore the failure.
    let (reader, writer) = std::io::pipe().expect("create a pipe");
    drop(reader);
    let no_vars: [(&str, &str); 0] = [];
    let output = run_to_exit(api(&no_vars).stderr(writer));
    assert_eq!(output.status.code(), Some(78));
    assert_eq!(output.stdout, "");
}

// covers: 0002 AC-1
#[cfg(unix)]
#[test]
fn a_value_that_is_not_utf8_is_reported() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;

    let url = database_url();
    let output = run_to_exit(&mut api(&[
        (OsStr::new("APP_ENV"), OsStr::from_bytes(b"dev\xffelopment")),
        (OsStr::new("DATABASE_URL"), OsStr::new(&url)),
    ]));
    assert_eq!(output.status.code(), Some(78));
    assert_eq!(output.stdout, "");
    assert_eq!(output.stderr, report(&["APP_ENV: must be valid UTF-8"]));
}
