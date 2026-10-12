//! Backend configuration (spec 0002).
//!
//! Every value is read once at start from the process environment, or from the
//! file named by `<NAME>_FILE` for secrets, and the whole schema is validated
//! before the listener opens. Messages never copy a value; only the path of a
//! secret file is ever printed.

use std::fmt;
use std::io;
use std::net::{IpAddr, Ipv6Addr};
use std::path::Path;

/// Returned by the variable reader when an environment value is not valid UTF-8.
#[derive(Debug)]
pub struct NotUnicode;

/// One row of the configuration schema.
#[derive(Debug, Clone, Copy)]
pub struct Var {
    pub name: &'static str,
    pub required: bool,
    /// Value used when the variable is unset; `Some("")` means empty.
    pub default: Option<&'static str>,
    // At run time the `Secret` field type carries this; the `.env.example` sync
    // test reads the flag.
    #[cfg_attr(not(test), allow(dead_code))]
    pub secret: bool,
    /// Whether `<NAME>_FILE` may supply the value instead.
    pub file_variant: bool,
}

const APP_ENV: Var = Var {
    name: "APP_ENV",
    required: true,
    default: None,
    secret: false,
    file_variant: false,
};
const APP_HOST: Var = Var {
    name: "APP_HOST",
    required: false,
    default: Some("127.0.0.1"),
    secret: false,
    file_variant: false,
};
const APP_PORT: Var = Var {
    name: "APP_PORT",
    required: false,
    default: Some("3000"),
    secret: false,
    file_variant: false,
};
const DATABASE_URL: Var = Var {
    name: "DATABASE_URL",
    required: true,
    default: None,
    secret: true,
    file_variant: true,
};
const DATABASE_MIGRATOR_URL: Var = Var {
    name: "DATABASE_MIGRATOR_URL",
    required: false,
    default: None,
    secret: true,
    file_variant: true,
};
const COOKIE_SECURE: Var = Var {
    name: "COOKIE_SECURE",
    required: false,
    default: Some("true"),
    secret: false,
    file_variant: false,
};
const CORS_ALLOWED_ORIGINS: Var = Var {
    name: "CORS_ALLOWED_ORIGINS",
    required: false,
    default: Some(""),
    secret: false,
    file_variant: false,
};
const DEV_SEED_ENABLED: Var = Var {
    name: "DEV_SEED_ENABLED",
    required: false,
    default: Some("false"),
    secret: false,
    file_variant: false,
};
const WEB_API_BASE_URL: Var = Var {
    name: "WEB_API_BASE_URL",
    required: false,
    default: Some("/api"),
    secret: false,
    file_variant: false,
};

/// The schema in report order; `.env.example` lists the same rows in the same order.
// Outside tests the rows are used one by one; the table as a whole is read by
// the test that keeps it in sync with `.env.example`.
#[cfg_attr(not(test), allow(dead_code))]
pub const SCHEMA: &[Var] = &[
    APP_ENV,
    APP_HOST,
    APP_PORT,
    DATABASE_URL,
    DATABASE_MIGRATOR_URL,
    COOKIE_SECURE,
    CORS_ALLOWED_ORIGINS,
    DEV_SEED_ENABLED,
    WEB_API_BASE_URL,
];

/// The largest `<NAME>_FILE` content accepted. `main` reads at most one byte
/// more, so a larger file fails without being loaded.
pub const MAX_SECRET_FILE_BYTES: usize = 8 * 1024;

const MSG_FILE_PATH_HIDDEN: &str =
    "cannot read file (path not shown because it looks like a URL or credential)";
const MSG_UTF8: &str = "must be valid UTF-8";
const MSG_REQUIRED: &str = "is required";
const MSG_WHITESPACE: &str = "must not start or end with whitespace";
const MSG_APP_ENV: &str = "must be one of development, test, staging, production";
const MSG_APP_HOST: &str = "must be an IPv4 or IPv6 address literal";
const MSG_APP_PORT: &str = "must be an integer from 1 to 65535";
const MSG_DATABASE_URL: &str =
    "must be a postgres:// or postgresql:// URL with user, host, and database name";
const MSG_SSLMODE_ONCE: &str =
    "use the sslmode query parameter at most once and no ssl-mode or ssl_mode aliases";
const MSG_SSLMODE_STRICT: &str =
    "sslmode must be require, verify-ca, or verify-full when APP_ENV is staging or production";
const MSG_BOOL: &str = "must be true or false";
const MSG_COOKIE_STRICT: &str = "must be true when APP_ENV is staging or production";
const MSG_SEED_STRICT: &str = "must be false when APP_ENV is staging or production";
const MSG_CORS_WILDCARD: &str = "* is not allowed";
const MSG_CORS: &str = "must be a comma-separated list of http:// or https:// origins without path, query, or trailing slash";
const MSG_CORS_STRICT: &str = "must use https:// origins when APP_ENV is staging or production";
const MSG_BASE_URL: &str = "must be a path starting with / or an http:// or https:// URL, without query, fragment, or trailing slash";
const MSG_BASE_URL_STRICT: &str =
    "must be a path or an https:// URL when APP_ENV is staging or production";

/// A secret value. `Debug` and `Display` print `[redacted]`; only `expose` reveals it.
pub struct Secret(String);

impl Secret {
    // Feature 6 reads the database URLs to open connections.
    #[allow(dead_code)]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

/// One problem line: `<name>: <message>`.
#[derive(Debug, PartialEq, Eq)]
pub struct ConfigError {
    pub name: String,
    pub message: String,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.name, self.message)
    }
}

#[derive(Debug)]
pub struct Config {
    pub host: IpAddr,
    pub port: u16,
    // Feature 6 opens the runtime database connection with it.
    #[allow(dead_code)]
    pub database_url: Secret,
    // Feature 6 runs the migration command with it.
    #[allow(dead_code)]
    pub database_migrator_url: Option<Secret>,
    // Feature 14 sets the Secure attribute of session cookies from it.
    #[allow(dead_code)]
    pub cookie_secure: bool,
    // Feature 26 builds the CORS policy from it.
    #[allow(dead_code)]
    pub cors_allowed_origins: Vec<String>,
    // Feature 17 allows the development seed only when it is true.
    #[allow(dead_code)]
    pub dev_seed_enabled: bool,
    // Features 30 and 31 write it to config.json as apiBaseUrl.
    #[allow(dead_code)]
    pub web_api_base_url: String,
}

impl Config {
    /// Reads and validates the whole schema. On failure every problem is
    /// returned, at most one per variable, in schema order.
    pub fn load<V, F>(read_var: V, read_file: F) -> Result<Config, Vec<ConfigError>>
    where
        V: Fn(&str) -> Result<Option<String>, NotUnicode>,
        F: Fn(&Path) -> io::Result<Vec<u8>>,
    {
        let mut loader = Loader {
            read_var,
            read_file,
            errors: Vec::new(),
        };
        let app_env = loader.field(&APP_ENV, parse_app_env);
        // Environment rules are skipped when APP_ENV itself is missing or invalid.
        let strict = matches!(app_env, Some(AppEnv::Staging | AppEnv::Production));
        let host = loader.field(&APP_HOST, parse_host);
        let port = loader.field(&APP_PORT, parse_port);
        let database_url = loader.field(&DATABASE_URL, |value| check_database_url(value, strict));
        let database_migrator_url = loader.field(&DATABASE_MIGRATOR_URL, |value| {
            check_database_url(value, strict)
        });
        let cookie_secure = loader.field(&COOKIE_SECURE, |value| {
            let secure = parse_bool(value)?;
            if strict && !secure {
                return Err(MSG_COOKIE_STRICT);
            }
            Ok(secure)
        });
        let cors_allowed_origins = loader.field(&CORS_ALLOWED_ORIGINS, |value| {
            let origins = parse_cors_origins(value)?;
            if strict && origins.iter().any(|origin| origin.starts_with("http://")) {
                return Err(MSG_CORS_STRICT);
            }
            Ok(origins)
        });
        let dev_seed_enabled = loader.field(&DEV_SEED_ENABLED, |value| {
            let enabled = parse_bool(value)?;
            if strict && enabled {
                return Err(MSG_SEED_STRICT);
            }
            Ok(enabled)
        });
        let web_api_base_url = loader.field(&WEB_API_BASE_URL, |value| {
            if !is_valid_base_url(value) {
                return Err(MSG_BASE_URL);
            }
            if strict && value.starts_with("http://") {
                return Err(MSG_BASE_URL_STRICT);
            }
            Ok(value.to_owned())
        });

        match (
            app_env,
            host,
            port,
            database_url,
            cookie_secure,
            cors_allowed_origins,
            dev_seed_enabled,
            web_api_base_url,
        ) {
            (
                Some(_),
                Some(host),
                Some(port),
                Some(database_url),
                Some(cookie_secure),
                Some(cors_allowed_origins),
                Some(dev_seed_enabled),
                Some(web_api_base_url),
            ) if loader.errors.is_empty() => Ok(Config {
                host,
                port,
                database_url,
                database_migrator_url,
                cookie_secure,
                cors_allowed_origins,
                dev_seed_enabled,
                web_api_base_url,
            }),
            _ => Err(loader.errors),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AppEnv {
    Development,
    Test,
    Staging,
    Production,
}

/// Where a value came from after the source rules (general rules 1 to 4).
enum Source {
    Set(String),
    Unset,
    Failed,
}

struct Loader<V, F> {
    read_var: V,
    read_file: F,
    errors: Vec<ConfigError>,
}

impl<V, F> Loader<V, F>
where
    V: Fn(&str) -> Result<Option<String>, NotUnicode>,
    F: Fn(&Path) -> io::Result<Vec<u8>>,
{
    fn fail(&mut self, name: &str, message: impl Into<String>) {
        self.errors.push(ConfigError {
            name: name.to_owned(),
            message: message.into(),
        });
    }

    /// Runs every rule for one variable. `None` means the variable failed, or is
    /// unset without a default; a failure is recorded in `errors`.
    fn field<T>(
        &mut self,
        var: &Var,
        check: impl FnOnce(&str) -> Result<T, &'static str>,
    ) -> Option<T> {
        let text = match self.source(var) {
            Source::Set(text) => text,
            Source::Unset => var.default?.to_owned(),
            Source::Failed => return None,
        };
        match check(&text) {
            Ok(value) => Some(value),
            Err(message) => {
                self.fail(var.name, message);
                None
            }
        }
    }

    /// General rules 1 to 4: source conflict and file problems, UTF-8, empty
    /// means unset, and surrounding whitespace.
    fn source(&mut self, var: &Var) -> Source {
        let file_name = format!("{}_FILE", var.name);
        let direct = (self.read_var)(var.name);
        let from_file = if var.file_variant {
            (self.read_var)(&file_name)
        } else {
            Ok(None)
        };

        // The arm order is the rule order; the first arm that matches decides.
        let value = match (direct, from_file) {
            // Rule 1: both sources set is a conflict.
            (direct, from_file) if is_set(&direct) && is_set(&from_file) => {
                self.fail(
                    var.name,
                    format!("set either {0} or {0}_FILE, not both", var.name),
                );
                return Source::Failed;
            }
            // Rule 2 for the file variable: its path is not UTF-8.
            (_, Err(NotUnicode)) => {
                self.fail(&file_name, MSG_UTF8);
                return Source::Failed;
            }
            // Rule 1: read the file; its problems name `<NAME>_FILE`.
            (_, Ok(Some(path))) if !path.is_empty() => {
                match self.read_secret_file(&file_name, &path) {
                    Some(value) => value,
                    None => return Source::Failed,
                }
            }
            // Rule 2: the variable itself is not UTF-8.
            (Err(NotUnicode), _) => {
                self.fail(var.name, MSG_UTF8);
                return Source::Failed;
            }
            (Ok(Some(value)), _) if !value.is_empty() => value,
            // Rule 3: empty means unset; a required variable fails here.
            _ if var.required => {
                self.fail(var.name, MSG_REQUIRED);
                return Source::Failed;
            }
            _ => return Source::Unset,
        };

        // Rule 4: surrounding whitespace, checked on the env value or file content.
        if value.starts_with(char::is_whitespace) || value.ends_with(char::is_whitespace) {
            self.fail(var.name, MSG_WHITESPACE);
            return Source::Failed;
        }
        Source::Set(value)
    }

    /// Reads a `<NAME>_FILE` secret. Messages name the path, never the content
    /// or the operating system error, and hide a path that looks like a URL or
    /// a credential put there by mistake.
    fn read_secret_file(&mut self, file_name: &str, path: &str) -> Option<String> {
        let Ok(bytes) = (self.read_file)(Path::new(path)) else {
            if path.contains("://") || path.contains('@') {
                self.fail(file_name, MSG_FILE_PATH_HIDDEN);
            } else {
                self.fail(file_name, format!("cannot read file \"{path}\""));
            }
            return None;
        };
        if bytes.len() > MAX_SECRET_FILE_BYTES {
            self.fail(file_name, "file is larger than 8 KiB");
            return None;
        }
        let Ok(text) = String::from_utf8(bytes) else {
            self.fail(file_name, "file is not valid UTF-8");
            return None;
        };
        let content = text
            .strip_suffix("\r\n")
            .or_else(|| text.strip_suffix('\n'))
            .unwrap_or(&text);
        if content.is_empty() {
            self.fail(file_name, "file is empty");
            return None;
        }
        Some(content.to_owned())
    }
}

/// A value counts as set when it is present and not empty. A value that is not
/// UTF-8 is never empty.
fn is_set(value: &Result<Option<String>, NotUnicode>) -> bool {
    match value {
        Ok(Some(text)) => !text.is_empty(),
        Ok(None) => false,
        Err(NotUnicode) => true,
    }
}

fn parse_app_env(value: &str) -> Result<AppEnv, &'static str> {
    match value {
        "development" => Ok(AppEnv::Development),
        "test" => Ok(AppEnv::Test),
        "staging" => Ok(AppEnv::Staging),
        "production" => Ok(AppEnv::Production),
        _ => Err(MSG_APP_ENV),
    }
}

/// An IPv4 or IPv6 literal; the standard parser rejects brackets and zone ids.
fn parse_host(value: &str) -> Result<IpAddr, &'static str> {
    value.parse().map_err(|_| MSG_APP_HOST)
}

fn parse_port(value: &str) -> Result<u16, &'static str> {
    port_number(value).ok_or(MSG_APP_PORT)
}

/// Decimal digits only, from 1 to 65535.
fn port_number(value: &str) -> Option<u16> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok().filter(|port| *port != 0)
}

fn parse_bool(value: &str) -> Result<bool, &'static str> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(MSG_BOOL),
    }
}

fn check_database_url(value: &str, strict: bool) -> Result<Secret, &'static str> {
    let sslmode = parse_database_url(value)?;
    if strict && !matches!(sslmode, Some("require" | "verify-ca" | "verify-full")) {
        return Err(MSG_SSLMODE_STRICT);
    }
    Ok(Secret(value.to_owned()))
}

/// Checks the database URL grammar and returns the raw `sslmode` value, if any.
fn parse_database_url(value: &str) -> Result<Option<&str>, &'static str> {
    let rest = value
        .strip_prefix("postgres://")
        .or_else(|| value.strip_prefix("postgresql://"))
        .ok_or(MSG_DATABASE_URL)?;
    if rest.contains('#') {
        return Err(MSG_DATABASE_URL);
    }
    let (authority, path_and_query) = rest
        .find('/')
        .map(|slash| rest.split_at(slash))
        .ok_or(MSG_DATABASE_URL)?;

    let (userinfo, host_port) = authority.split_once('@').ok_or(MSG_DATABASE_URL)?;
    let user = userinfo.split(':').next().unwrap_or_default();
    if user.is_empty() || !is_url_component(userinfo) || !is_database_host(host_port) {
        return Err(MSG_DATABASE_URL);
    }

    let path_and_query = &path_and_query[1..];
    let (database, query) = match path_and_query.split_once('?') {
        Some((database, query)) => (database, Some(query)),
        None => (path_and_query, None),
    };
    if database.is_empty() || !is_url_component(database) {
        return Err(MSG_DATABASE_URL);
    }

    let mut parameters = Vec::new();
    for pair in query.map(|query| query.split('&')).into_iter().flatten() {
        let (key, raw) = pair.split_once('=').ok_or(MSG_DATABASE_URL)?;
        if key.is_empty() || !is_url_component(key) || !is_url_component(raw) {
            return Err(MSG_DATABASE_URL);
        }
        parameters.push((percent_decode(key), raw));
    }

    let mut sslmode = None;
    for (key, raw) in parameters {
        match key.as_slice() {
            b"ssl-mode" | b"ssl_mode" => return Err(MSG_SSLMODE_ONCE),
            b"sslmode" if sslmode.is_some() => return Err(MSG_SSLMODE_ONCE),
            b"sslmode" => sslmode = Some(raw),
            _ => {}
        }
    }
    Ok(sslmode)
}

/// `host[:port]` where host is a name made of `[A-Za-z0-9.-]` (which covers
/// IPv4) or an IPv6 address in brackets.
fn is_database_host(host_port: &str) -> bool {
    let name_byte = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-';
    match split_host_port(host_port, name_byte) {
        Some(None) => true,
        Some(Some(port)) => port_number(port).is_some(),
        None => false,
    }
}

/// Splits `host[:port]`. The host is an IPv6 address in brackets or a non
/// empty name whose bytes pass `name_byte`. Returns the port text when a `:`
/// follows the host, and `None` when the host is invalid or anything else
/// follows it.
fn split_host_port(text: &str, name_byte: impl Fn(u8) -> bool) -> Option<Option<&str>> {
    let after = if let Some(inner) = text.strip_prefix('[') {
        let (address, after) = inner.split_once(']')?;
        address.parse::<Ipv6Addr>().ok()?;
        after
    } else {
        let end = text.find(':').unwrap_or(text.len());
        let (host, after) = text.split_at(end);
        if host.is_empty() || !host.bytes().all(&name_byte) {
            return None;
        }
        after
    };
    if after.is_empty() {
        return Some(None);
    }
    after.strip_prefix(':').map(Some)
}

/// Userinfo, database name, and query text: no raw whitespace, control
/// characters, `@`, `/`, `?`, or `#`, and every `%` starts a two digit hex escape.
fn is_url_component(text: &str) -> bool {
    let forbidden = |c: char| c.is_whitespace() || c.is_control() || "@/?#".contains(c);
    !text.contains(forbidden) && has_valid_escapes(text)
}

fn has_valid_escapes(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.iter().enumerate().all(|(index, byte)| {
        *byte != b'%'
            || (bytes.get(index + 1).is_some_and(u8::is_ascii_hexdigit)
                && bytes.get(index + 2).is_some_and(u8::is_ascii_hexdigit))
    })
}

/// Decodes `%XX` escapes to bytes; call only on text with valid escapes.
fn percent_decode(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && let Some(byte) = text
                .get(index + 1..index + 3)
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
        {
            decoded.push(byte);
            index += 3;
            continue;
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    decoded
}

/// Comma separated origins; the empty default means same origin only.
fn parse_cors_origins(value: &str) -> Result<Vec<String>, &'static str> {
    if value.is_empty() {
        return Ok(Vec::new());
    }
    let items: Vec<&str> = value.split(',').collect();
    if items.contains(&"*") {
        return Err(MSG_CORS_WILDCARD);
    }
    if !items.iter().all(|item| is_origin(item)) {
        return Err(MSG_CORS);
    }
    Ok(items.into_iter().map(str::to_owned).collect())
}

/// `http` or `https`, a lower case host or a bracketed IPv6 address, and an
/// optional port that is not the scheme default. Nothing after the port.
fn is_origin(item: &str) -> bool {
    let (rest, default_port) = if let Some(rest) = item.strip_prefix("http://") {
        (rest, 80)
    } else if let Some(rest) = item.strip_prefix("https://") {
        (rest, 443)
    } else {
        return false;
    };
    let name_byte = |byte: u8| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'.' || byte == b'-'
    };
    match split_host_port(rest, name_byte) {
        Some(None) => true,
        Some(Some(port)) => port_number(port).is_some_and(|port| port != default_port),
        None => false,
    }
}

/// The shared URL rule for `WEB_API_BASE_URL` and the frontend `apiBaseUrl`;
/// `apps/web/src/app/config/app-config.ts` applies the same rule.
fn is_valid_base_url(value: &str) -> bool {
    if value.contains(|c: char| c.is_whitespace() || c.is_control() || c == '\\')
        || value.contains(['?', '#'])
        || value.ends_with('/')
    {
        return false;
    }
    if let Some(path) = value.strip_prefix('/') {
        return !path.is_empty() && !path.starts_with('/');
    }
    let Some(rest) = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))
    else {
        return false;
    };
    let authority = rest.split('/').next().unwrap_or_default();
    let host = authority.split(':').next().unwrap_or_default();
    !authority.contains('@') && !host.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;

    const MARKER: &str = "pw-marker-5f3a91";
    const VALID_URL: &str = "postgres://app:pw-marker-5f3a91@127.0.0.1:5432/app";
    const TLS_URL: &str = "postgres://app:pw-marker-5f3a91@db.internal:5432/app?sslmode=require";

    /// Shared URL vectors from spec 0002, also used by `app-config.spec.ts`.
    const VALID_BASE_URLS: &[&str] = &[
        "/api",
        "/api/v1",
        "https://api.example.com",
        "https://api.example.com:8443/base",
        "http://localhost:3000",
    ];
    const INVALID_BASE_URLS: &[&str] = &[
        "",
        "/",
        "/api/",
        "//evil.example",
        "/\\evil.example",
        "api",
        "https://user:pass@api.example.com",
        "https://",
        "HTTP://api.example.com",
        "https://api.example.com/?x=1",
        "https://api.example.com#f",
        "ftp://example.com",
        " /api",
        "/a pi",
    ];

    /// An environment (a `None` value is not valid UTF-8) and readable files.
    #[derive(Default)]
    struct Fixture {
        vars: HashMap<String, Option<String>>,
        files: HashMap<PathBuf, Vec<u8>>,
    }

    impl Fixture {
        fn new(vars: &[(&str, &str)]) -> Self {
            let mut fixture = Fixture::default();
            for (name, value) in vars {
                fixture.set(name, value);
            }
            fixture
        }

        /// `APP_ENV=development` plus a valid `DATABASE_URL`.
        fn development() -> Self {
            Fixture::new(&[("APP_ENV", "development"), ("DATABASE_URL", VALID_URL)])
        }

        /// A staging or production environment where every value is safe.
        fn strict(app_env: &str) -> Self {
            Fixture::new(&[("APP_ENV", app_env), ("DATABASE_URL", TLS_URL)])
        }

        fn set(&mut self, name: &str, value: &str) -> &mut Self {
            self.vars.insert(name.to_owned(), Some(value.to_owned()));
            self
        }

        fn remove(&mut self, name: &str) -> &mut Self {
            self.vars.remove(name);
            self
        }

        fn not_unicode(&mut self, name: &str) -> &mut Self {
            self.vars.insert(name.to_owned(), None);
            self
        }

        fn file(&mut self, path: &str, content: &[u8]) -> &mut Self {
            self.files.insert(PathBuf::from(path), content.to_vec());
            self
        }

        fn load(&self) -> Result<Config, Vec<ConfigError>> {
            Config::load(
                |name: &str| match self.vars.get(name) {
                    None => Ok(None),
                    Some(Some(value)) => Ok(Some(value.clone())),
                    Some(None) => Err(NotUnicode),
                },
                |path: &Path| {
                    self.files
                        .get(path)
                        .cloned()
                        .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
                },
            )
        }

        fn config(&self) -> Config {
            match self.load() {
                Ok(config) => config,
                Err(errors) => panic!(
                    "expected a valid configuration, got {}",
                    lines(&errors).join(" | ")
                ),
            }
        }

        /// The reported lines; they must never contain the password marker.
        fn errors(&self) -> Vec<String> {
            match self.load() {
                Ok(config) => panic!("expected configuration errors, got {config:?}"),
                Err(errors) => {
                    let lines = lines(&errors);
                    for line in &lines {
                        assert!(!line.contains(MARKER), "a message copied the value: {line}");
                    }
                    lines
                }
            }
        }

        fn error(&self) -> String {
            let errors = self.errors();
            assert_eq!(errors.len(), 1, "expected exactly one line, got {errors:?}");
            errors[0].clone()
        }
    }

    fn lines(errors: &[ConfigError]) -> Vec<String> {
        errors.iter().map(ToString::to_string).collect()
    }

    fn line(name: &str, message: &str) -> String {
        format!("{name}: {message}")
    }

    // covers: 0002 AC-2
    #[test]
    fn minimal_development_values_use_safe_defaults() {
        let config = Fixture::development().config();
        assert_eq!(config.host, IpAddr::from([127, 0, 0, 1]));
        assert_eq!(config.port, 3000);
        assert_eq!(config.database_url.expose(), VALID_URL);
        assert!(config.database_migrator_url.is_none());
        assert!(config.cookie_secure);
        assert!(config.cors_allowed_origins.is_empty());
        assert!(!config.dev_seed_enabled);
        assert_eq!(config.web_api_base_url, "/api");
    }

    // covers: 0002 AC-2
    #[test]
    fn host_and_port_override_the_defaults() {
        let config = Fixture::development()
            .set("APP_HOST", "::1")
            .set("APP_PORT", "8080")
            .config();
        assert_eq!(config.host, "::1".parse::<IpAddr>().unwrap());
        assert_eq!(config.port, 8080);
    }

    // covers: 0002 AC-1
    #[test]
    fn every_problem_is_reported_once_in_schema_order() {
        let errors = Fixture::new(&[
            ("APP_ENV", "prod"),
            ("APP_HOST", "localhost"),
            ("APP_PORT", "0"),
            ("DATABASE_MIGRATOR_URL", "mysql://app@db/app"),
            ("COOKIE_SECURE", "yes"),
            ("CORS_ALLOWED_ORIGINS", "*"),
            ("DEV_SEED_ENABLED", "1"),
            ("WEB_API_BASE_URL", "api"),
        ])
        .errors();
        assert_eq!(
            errors,
            [
                line("APP_ENV", MSG_APP_ENV),
                line("APP_HOST", MSG_APP_HOST),
                line("APP_PORT", MSG_APP_PORT),
                line("DATABASE_URL", MSG_REQUIRED),
                line("DATABASE_MIGRATOR_URL", MSG_DATABASE_URL),
                line("COOKIE_SECURE", MSG_BOOL),
                line("CORS_ALLOWED_ORIGINS", MSG_CORS_WILDCARD),
                line("DEV_SEED_ENABLED", MSG_BOOL),
                line("WEB_API_BASE_URL", MSG_BASE_URL),
            ]
        );
        let names: Vec<&str> = SCHEMA.iter().map(|var| var.name).collect();
        let reported: Vec<&str> = errors
            .iter()
            .map(|line| line.split(':').next().unwrap())
            .collect();
        assert_eq!(reported, names);
    }

    // covers: 0002 AC-1
    #[test]
    fn message_texts_match_the_spec_table() {
        assert_eq!(
            MSG_FILE_PATH_HIDDEN,
            "cannot read file (path not shown because it looks like a URL or credential)"
        );
        assert_eq!(MSG_UTF8, "must be valid UTF-8");
        assert_eq!(MSG_REQUIRED, "is required");
        assert_eq!(MSG_WHITESPACE, "must not start or end with whitespace");
        assert_eq!(
            MSG_APP_ENV,
            "must be one of development, test, staging, production"
        );
        assert_eq!(MSG_APP_HOST, "must be an IPv4 or IPv6 address literal");
        assert_eq!(MSG_APP_PORT, "must be an integer from 1 to 65535");
        assert_eq!(
            MSG_DATABASE_URL,
            "must be a postgres:// or postgresql:// URL with user, host, and database name"
        );
        assert_eq!(
            MSG_SSLMODE_ONCE,
            "use the sslmode query parameter at most once and no ssl-mode or ssl_mode aliases"
        );
        assert_eq!(
            MSG_SSLMODE_STRICT,
            "sslmode must be require, verify-ca, or verify-full when APP_ENV is staging or production"
        );
        assert_eq!(MSG_BOOL, "must be true or false");
        assert_eq!(
            MSG_COOKIE_STRICT,
            "must be true when APP_ENV is staging or production"
        );
        assert_eq!(
            MSG_SEED_STRICT,
            "must be false when APP_ENV is staging or production"
        );
        assert_eq!(MSG_CORS_WILDCARD, "* is not allowed");
        assert_eq!(
            MSG_CORS,
            "must be a comma-separated list of http:// or https:// origins without path, query, or trailing slash"
        );
        assert_eq!(
            MSG_CORS_STRICT,
            "must use https:// origins when APP_ENV is staging or production"
        );
        assert_eq!(
            MSG_BASE_URL,
            "must be a path starting with / or an http:// or https:// URL, without query, fragment, or trailing slash"
        );
        assert_eq!(
            MSG_BASE_URL_STRICT,
            "must be a path or an https:// URL when APP_ENV is staging or production"
        );
    }

    // covers: 0002 AC-1
    #[test]
    fn required_variables_that_are_missing_or_empty_are_reported() {
        assert_eq!(
            Fixture::new(&[]).errors(),
            [
                line("APP_ENV", MSG_REQUIRED),
                line("DATABASE_URL", MSG_REQUIRED)
            ]
        );
        assert_eq!(
            Fixture::new(&[("APP_ENV", ""), ("DATABASE_URL", "")]).errors(),
            [
                line("APP_ENV", MSG_REQUIRED),
                line("DATABASE_URL", MSG_REQUIRED)
            ]
        );
    }

    // covers: 0002 AC-1
    #[test]
    fn empty_optional_values_fall_back_to_their_defaults() {
        let mut fixture = Fixture::development();
        for var in SCHEMA.iter().filter(|var| !var.required) {
            fixture.set(var.name, "");
        }
        let config = fixture.config();
        assert_eq!(config.port, 3000);
        assert!(config.cookie_secure);
        assert_eq!(config.web_api_base_url, "/api");
        assert!(config.database_migrator_url.is_none());
    }

    // covers: 0002 AC-1
    #[test]
    fn values_that_are_not_utf8_are_reported() {
        assert_eq!(
            Fixture::development().not_unicode("APP_ENV").error(),
            line("APP_ENV", MSG_UTF8)
        );
        assert_eq!(
            Fixture::development().not_unicode("DATABASE_URL").error(),
            line("DATABASE_URL", MSG_UTF8)
        );
        assert_eq!(
            Fixture::development()
                .remove("DATABASE_URL")
                .not_unicode("DATABASE_URL_FILE")
                .error(),
            line("DATABASE_URL_FILE", MSG_UTF8)
        );
    }

    // covers: 0002 AC-1
    #[test]
    fn surrounding_whitespace_is_rejected_before_the_grammar() {
        for value in [
            " development",
            "development ",
            "\tdevelopment",
            "development\n",
        ] {
            assert_eq!(
                Fixture::development().set("APP_ENV", value).error(),
                line("APP_ENV", MSG_WHITESPACE)
            );
        }
        assert_eq!(
            Fixture::development().set("APP_PORT", " 80").error(),
            line("APP_PORT", MSG_WHITESPACE)
        );
        let padded = format!("{VALID_URL}\u{a0}");
        assert_eq!(
            Fixture::development().set("DATABASE_URL", &padded).error(),
            line("DATABASE_URL", MSG_WHITESPACE)
        );
    }

    // covers: 0002 AC-1
    #[test]
    fn app_env_accepts_only_the_four_lower_case_names() {
        for value in ["development", "test", "staging", "production"] {
            assert!(
                Fixture::strict(value).load().is_ok(),
                "{value} should be accepted"
            );
        }
        for value in ["Production", "prod", "dev", "local", "PRODUCTION"] {
            assert_eq!(
                Fixture::development().set("APP_ENV", value).error(),
                line("APP_ENV", MSG_APP_ENV)
            );
        }
    }

    // covers: 0002 AC-1, 0002 AC-2
    #[test]
    fn app_host_accepts_only_ip_literals() {
        for value in [
            "127.0.0.1",
            "0.0.0.0",
            "192.168.1.10",
            "::",
            "::1",
            "fe80::1",
        ] {
            let config = Fixture::development().set("APP_HOST", value).config();
            assert_eq!(config.host, value.parse::<IpAddr>().unwrap());
        }
        for value in [
            "localhost",
            "[::1]",
            "fe80::1%en0",
            "127.0.0.1:80",
            "1.2.3",
            "256.0.0.1",
            "example.com",
        ] {
            assert_eq!(
                Fixture::development().set("APP_HOST", value).error(),
                line("APP_HOST", MSG_APP_HOST),
                "{value}"
            );
        }
    }

    // covers: 0002 AC-1, 0002 AC-2
    #[test]
    fn app_port_accepts_integers_from_1_to_65535() {
        for (value, port) in [("1", 1), ("3000", 3000), ("65535", 65535)] {
            assert_eq!(
                Fixture::development().set("APP_PORT", value).config().port,
                port
            );
        }
        for value in [
            "0",
            "65536",
            "-1",
            "+80",
            "80a",
            "3.0",
            "0x50",
            "99999999999",
        ] {
            assert_eq!(
                Fixture::development().set("APP_PORT", value).error(),
                line("APP_PORT", MSG_APP_PORT),
                "{value}"
            );
        }
    }

    // covers: 0002 AC-3
    #[test]
    fn database_urls_that_follow_the_grammar_are_accepted() {
        for url in [
            "postgres://app@localhost/app",
            "postgresql://app:@localhost/app",
            "postgres://app:p%40ss%2Fw0rd@db-1.internal:6543/app_dev",
            "postgres://app:pa:ss@10.0.0.5/app",
            "postgres://app:pw@[::1]:5432/app",
            "postgres://app:pw@[2001:db8::1]/app",
            "postgres://app:pw@localhost/app?sslmode=disable",
            "postgres://app:pw@localhost/app?application_name=api&connect_timeout=5",
            "postgres://app:pw@localhost/app?options=-c%20search_path%3Dapp",
            "postgres://app:pw@localhost/my%20db",
            "postgres://app:pw@localhost/app?k=",
        ] {
            let config = Fixture::development()
                .set("DATABASE_URL", url)
                .set("DATABASE_MIGRATOR_URL", url)
                .config();
            assert_eq!(config.database_url.expose(), url);
            assert_eq!(
                config.database_migrator_url.as_ref().map(Secret::expose),
                Some(url)
            );
        }
    }

    // covers: 0002 AC-3, 0002 AC-4
    #[test]
    fn database_urls_that_break_the_grammar_are_rejected_without_echo() {
        for url in [
            "mysql://app:pw-marker-5f3a91@localhost/app",
            "Postgres://app:pw-marker-5f3a91@localhost/app",
            "POSTGRES://app:pw-marker-5f3a91@localhost/app",
            "postgres:/app:pw-marker-5f3a91@localhost/app",
            "postgres://app:pw-marker-5f3a91@localhost",
            "postgres://app:pw-marker-5f3a91@localhost/",
            "postgres://app:pw-marker-5f3a91@localhost/app/extra",
            "postgres://localhost/app",
            "postgres://:pw-marker-5f3a91@localhost/app",
            "postgres://app:pw-marker-5f3a91@/app",
            "postgres://app:pw-marker-5f3a91@@localhost/app",
            "postgres://app:pw@marker-5f3a91@localhost/app",
            "postgres://app:pw-marker-5f3a91@host_1/app",
            "postgres://app:pw-marker-5f3a91@db1,db2/app",
            "postgres://app:pw-marker-5f3a91@localhost:0/app",
            "postgres://app:pw-marker-5f3a91@localhost:65536/app",
            "postgres://app:pw-marker-5f3a91@localhost:/app",
            "postgres://app:pw-marker-5f3a91@localhost:5432x/app",
            "postgres://app:pw-marker-5f3a91@[::1/app",
            "postgres://app:pw-marker-5f3a91@[not-ipv6]/app",
            "postgres://app:pw-marker-5f3a91@[fe80::1%25en0]/app",
            "postgres://app:pw marker-5f3a91@localhost/app",
            "postgres://app:pw-marker-5f3a91\u{7}@localhost/app",
            "postgres://app:pw-marker-5f3a91%@localhost/app",
            "postgres://app:pw-marker-5f3a91%2@localhost/app",
            "postgres://app:pw-marker-5f3a91%zz@localhost/app",
            "postgres://app:pw?marker-5f3a91@localhost/app",
            "postgres://app:pw#marker-5f3a91@localhost/app",
            "postgres://app:pw-marker-5f3a91@localhost/my db",
            "postgres://app:pw-marker-5f3a91@localhost/app@x",
            "postgres://app:pw-marker-5f3a91@localhost/app#fragment",
            "postgres://app:pw-marker-5f3a91@localhost/app?",
            "postgres://app:pw-marker-5f3a91@localhost/app?sslmode",
            "postgres://app:pw-marker-5f3a91@localhost/app?=require",
            "postgres://app:pw-marker-5f3a91@localhost/app?sslmode=require&",
            "postgres://app:pw-marker-5f3a91@localhost/app?a=1&&b=2",
            "postgres://app:pw-marker-5f3a91@localhost/app?a=b/c",
            "postgres://app:pw-marker-5f3a91@localhost/app?a=b?c",
            "postgres://app:pw-marker-5f3a91@localhost/app?a=b@c",
            "postgres://app:pw-marker-5f3a91@localhost/app?a=b c",
            "postgres://app:pw-marker-5f3a91@localhost/app?a=%G1",
        ] {
            assert_eq!(
                Fixture::development().set("DATABASE_URL", url).error(),
                line("DATABASE_URL", MSG_DATABASE_URL),
                "{url}"
            );
            assert_eq!(
                Fixture::development()
                    .set("DATABASE_MIGRATOR_URL", url)
                    .error(),
                line("DATABASE_MIGRATOR_URL", MSG_DATABASE_URL),
                "{url}"
            );
        }
    }

    // covers: 0002 AC-3
    #[test]
    fn sslmode_aliases_and_repeats_are_rejected_in_every_environment() {
        for query in [
            "sslmode=require&sslmode=require",
            "sslmode=disable&sslmode=require",
            "ssl-mode=require",
            "ssl_mode=require",
            "ssl%2Dmode=require",
            "ssl%5fmode=require",
            "sslmod%65=require&sslmode=require",
        ] {
            let url = format!("postgres://app:{MARKER}@localhost/app?{query}");
            for app_env in ["development", "production"] {
                assert_eq!(
                    Fixture::strict(app_env).set("DATABASE_URL", &url).error(),
                    line("DATABASE_URL", MSG_SSLMODE_ONCE),
                    "{query} in {app_env}"
                );
            }
        }
    }

    // covers: 0002 AC-3
    #[test]
    fn staging_and_production_require_a_tls_sslmode_on_both_urls() {
        for app_env in ["staging", "production"] {
            for mode in ["require", "verify-ca", "verify-full"] {
                let url =
                    format!("postgres://app:{MARKER}@db/app?application_name=api&sslmode={mode}");
                let config = Fixture::strict(app_env)
                    .set("DATABASE_URL", &url)
                    .set("DATABASE_MIGRATOR_URL", &url)
                    .config();
                assert_eq!(config.database_url.expose(), url);
            }
            for suffix in [
                "",
                "?sslmode=disable",
                "?sslmode=prefer",
                "?sslmode=allow",
                "?sslmode=REQUIRE",
                "?sslmode=requir%65",
                "?sslmode=",
                "?SSLMODE=require",
            ] {
                let url = format!("postgres://app:{MARKER}@db/app{suffix}");
                assert_eq!(
                    Fixture::strict(app_env).set("DATABASE_URL", &url).error(),
                    line("DATABASE_URL", MSG_SSLMODE_STRICT),
                    "{suffix} in {app_env}"
                );
                assert_eq!(
                    Fixture::strict(app_env)
                        .set("DATABASE_MIGRATOR_URL", &url)
                        .error(),
                    line("DATABASE_MIGRATOR_URL", MSG_SSLMODE_STRICT),
                    "{suffix} in {app_env}"
                );
            }
        }
    }

    // covers: 0002 AC-1
    #[test]
    fn booleans_accept_only_lower_case_true_and_false() {
        for name in ["COOKIE_SECURE", "DEV_SEED_ENABLED"] {
            for value in ["TRUE", "False", "1", "0", "yes", "no", "on"] {
                assert_eq!(
                    Fixture::development().set(name, value).error(),
                    line(name, MSG_BOOL),
                    "{name}={value}"
                );
            }
        }
        let config = Fixture::development()
            .set("COOKIE_SECURE", "false")
            .set("DEV_SEED_ENABLED", "true")
            .config();
        assert!(!config.cookie_secure);
        assert!(config.dev_seed_enabled);
    }

    // covers: 0002 AC-1
    #[test]
    fn cors_wildcard_is_rejected_in_every_environment() {
        for value in [
            "*",
            "https://app.example.com,*",
            "*,https://app.example.com",
        ] {
            for app_env in ["development", "test", "staging", "production"] {
                assert_eq!(
                    Fixture::strict(app_env)
                        .set("CORS_ALLOWED_ORIGINS", value)
                        .error(),
                    line("CORS_ALLOWED_ORIGINS", MSG_CORS_WILDCARD),
                    "{value} in {app_env}"
                );
            }
        }
    }

    // covers: 0002 AC-3
    #[test]
    fn cors_origins_follow_the_grammar() {
        let config = Fixture::development()
            .set(
                "CORS_ALLOWED_ORIGINS",
                "https://app.example.com,http://localhost:4200,https://[::1]:8443,https://app.example.com",
            )
            .config();
        assert_eq!(
            config.cors_allowed_origins,
            [
                "https://app.example.com",
                "http://localhost:4200",
                "https://[::1]:8443",
                "https://app.example.com"
            ]
        );
        for value in [
            "https://App.example.com",
            "HTTPS://app.example.com",
            "ftp://app.example.com",
            "app.example.com",
            "https://app.example.com/",
            "https://app.example.com/path",
            "https://app.example.com?x=1",
            "https://app.example.com#f",
            "https://user@app.example.com",
            "https://app.example.com:443",
            "http://app.example.com:80",
            "https://app.example.com:0",
            "https://app.example.com:65536",
            "https://app.example.com:",
            "https://",
            "https://app_example.com",
            "https://[::1",
            "https://app.example.com,",
            ",https://app.example.com",
            "https://a.example.com,,https://b.example.com",
            "https://a.example.com, https://b.example.com",
            "https://*.example.com",
        ] {
            assert_eq!(
                Fixture::development()
                    .set("CORS_ALLOWED_ORIGINS", value)
                    .error(),
                line("CORS_ALLOWED_ORIGINS", MSG_CORS),
                "{value}"
            );
        }
    }

    // covers: 0002 AC-3
    #[test]
    fn shared_url_vectors_hold_for_web_api_base_url() {
        for value in VALID_BASE_URLS {
            assert!(is_valid_base_url(value), "{value} should be valid");
            let config = Fixture::development()
                .set("WEB_API_BASE_URL", value)
                .config();
            assert_eq!(config.web_api_base_url, *value);
        }
        for value in INVALID_BASE_URLS {
            assert!(!is_valid_base_url(value), "{value:?} should be invalid");
        }
        for value in INVALID_BASE_URLS
            .iter()
            .filter(|value| !value.is_empty() && !value.starts_with(' '))
        {
            assert_eq!(
                Fixture::development()
                    .set("WEB_API_BASE_URL", value)
                    .error(),
                line("WEB_API_BASE_URL", MSG_BASE_URL),
                "{value}"
            );
        }
        assert!(!is_valid_base_url("https://api.example.com\\x"));
    }

    // Parity with `isValidBaseUrl` in apps/web/src/app/config/app-config.ts,
    // added by the author on top of the spec vectors. The TypeScript test lists
    // the same code points, so the two languages cannot drift apart.
    const SPACE_OR_CONTROL: &[u32] = &[
        0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x20, 0x7f, 0x85, 0x9f, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028,
        0x2029, 0x202f, 0x205f, 0x3000,
    ];
    const NEITHER_SPACE_NOR_CONTROL: &[u32] = &[0xa1, 0x180e, 0x200b, 0x200c, 0xfeff];

    fn with_code_point(code_point: u32) -> String {
        let c = char::from_u32(code_point).expect("a valid code point");
        format!("/api{c}v1")
    }

    // covers: 0002 AC-3
    #[test]
    fn whitespace_and_control_characters_match_the_frontend_rule() {
        for code_point in SPACE_OR_CONTROL {
            let value = with_code_point(*code_point);
            assert!(
                !is_valid_base_url(&value),
                "U+{code_point:04X} should be rejected"
            );
        }
        for code_point in NEITHER_SPACE_NOR_CONTROL {
            let value = with_code_point(*code_point);
            assert!(
                is_valid_base_url(&value),
                "U+{code_point:04X} should be accepted"
            );
        }
    }

    // covers: 0002 AC-3
    #[test]
    fn staging_and_production_reject_every_unsafe_value() {
        let unsafe_values = [
            ("COOKIE_SECURE", "false", MSG_COOKIE_STRICT),
            ("DEV_SEED_ENABLED", "true", MSG_SEED_STRICT),
            (
                "CORS_ALLOWED_ORIGINS",
                "https://app.example.com,http://app.example.com",
                MSG_CORS_STRICT,
            ),
            (
                "WEB_API_BASE_URL",
                "http://api.example.com",
                MSG_BASE_URL_STRICT,
            ),
            (
                "DATABASE_URL",
                "postgres://app:pw-marker-5f3a91@db/app",
                MSG_SSLMODE_STRICT,
            ),
            (
                "DATABASE_MIGRATOR_URL",
                "postgres://app:pw-marker-5f3a91@db/app?sslmode=disable",
                MSG_SSLMODE_STRICT,
            ),
        ];
        for app_env in ["staging", "production"] {
            for (name, value, message) in unsafe_values {
                assert_eq!(
                    Fixture::strict(app_env).set(name, value).error(),
                    line(name, message),
                    "{name}={value} in {app_env}"
                );
            }
        }
        // The same values are accepted in development and test.
        for app_env in ["development", "test"] {
            let mut fixture = Fixture::strict(app_env);
            for (name, value, _) in unsafe_values {
                fixture.set(name, value);
            }
            let config = fixture.config();
            assert!(!config.cookie_secure);
            assert!(config.dev_seed_enabled);
            assert_eq!(config.web_api_base_url, "http://api.example.com");
        }
        // Safe values pass in production and staging.
        let config = Fixture::strict("production")
            .set("COOKIE_SECURE", "true")
            .set("DEV_SEED_ENABLED", "false")
            .set("CORS_ALLOWED_ORIGINS", "https://app.example.com")
            .set("WEB_API_BASE_URL", "https://api.example.com")
            .set("DATABASE_MIGRATOR_URL", TLS_URL)
            .config();
        assert!(config.cookie_secure);
        let config = Fixture::strict("staging")
            .set("WEB_API_BASE_URL", "/api")
            .config();
        assert_eq!(config.web_api_base_url, "/api");
    }

    // covers: 0002 AC-3
    #[test]
    fn environment_rules_are_skipped_when_app_env_is_missing_or_invalid() {
        for app_env in [None, Some("prod")] {
            let mut fixture = Fixture::new(&[
                ("DATABASE_URL", "postgres://app@db/app"),
                ("COOKIE_SECURE", "false"),
                ("DEV_SEED_ENABLED", "true"),
                ("CORS_ALLOWED_ORIGINS", "http://app.example.com"),
                ("WEB_API_BASE_URL", "http://api.example.com"),
            ]);
            let expected = match app_env {
                Some(value) => {
                    fixture.set("APP_ENV", value);
                    line("APP_ENV", MSG_APP_ENV)
                }
                None => line("APP_ENV", MSG_REQUIRED),
            };
            assert_eq!(fixture.errors(), [expected]);
        }
    }

    // covers: 0002 AC-4
    #[test]
    fn secrets_are_redacted_in_debug_and_display() {
        let config = Fixture::development()
            .set("DATABASE_MIGRATOR_URL", VALID_URL)
            .config();
        let debug = format!("{config:?}");
        assert!(!debug.contains(MARKER), "{debug}");
        assert_eq!(debug.matches("[redacted]").count(), 2, "{debug}");
        let pretty = format!("{config:#?}");
        assert!(!pretty.contains(MARKER));
        assert_eq!(config.database_url.to_string(), "[redacted]");
        assert_eq!(format!("{:?}", config.database_url), "[redacted]");
        assert_eq!(config.database_url.expose(), VALID_URL);
    }

    // covers: 0002 AC-4
    #[test]
    fn secret_files_supply_the_value() {
        let url = format!("{VALID_URL}?sslmode=verify-full");
        for content in [url.clone(), format!("{url}\n"), format!("{url}\r\n")] {
            let config = Fixture::strict("production")
                .remove("DATABASE_URL")
                .set("DATABASE_URL_FILE", "/run/secrets/database_url")
                .file("/run/secrets/database_url", content.as_bytes())
                .set("DATABASE_MIGRATOR_URL_FILE", "relative/migrator url")
                .file("relative/migrator url", content.as_bytes())
                .config();
            assert_eq!(config.database_url.expose(), url);
            assert_eq!(
                config.database_migrator_url.as_ref().map(Secret::expose),
                Some(url.as_str())
            );
        }
    }

    // covers: 0002 AC-4
    #[test]
    fn setting_a_secret_and_its_file_is_a_conflict() {
        assert_eq!(
            Fixture::development()
                .set("DATABASE_URL_FILE", "/run/secrets/database_url")
                .file("/run/secrets/database_url", VALID_URL.as_bytes())
                .error(),
            line(
                "DATABASE_URL",
                "set either DATABASE_URL or DATABASE_URL_FILE, not both"
            )
        );
        assert_eq!(
            Fixture::development()
                .set("DATABASE_MIGRATOR_URL", VALID_URL)
                .set("DATABASE_MIGRATOR_URL_FILE", "/missing")
                .error(),
            line(
                "DATABASE_MIGRATOR_URL",
                "set either DATABASE_MIGRATOR_URL or DATABASE_MIGRATOR_URL_FILE, not both"
            )
        );
        assert_eq!(
            Fixture::development()
                .not_unicode("DATABASE_URL")
                .set("DATABASE_URL_FILE", "/missing")
                .error(),
            line(
                "DATABASE_URL",
                "set either DATABASE_URL or DATABASE_URL_FILE, not both"
            )
        );
        // An empty variable counts as unset, so this is not a conflict.
        let config = Fixture::development()
            .set("DATABASE_URL_FILE", "")
            .set("DATABASE_MIGRATOR_URL", "")
            .set("DATABASE_MIGRATOR_URL_FILE", "/run/secrets/migrator")
            .file("/run/secrets/migrator", VALID_URL.as_bytes())
            .config();
        assert_eq!(config.database_url.expose(), VALID_URL);
        assert!(config.database_migrator_url.is_some());
    }

    // covers: 0002 AC-4
    #[test]
    fn secret_file_problems_name_the_file_variable_and_path_only() {
        let path = "/run/secrets/database url";
        let with_file = |content: &[u8]| {
            Fixture::development()
                .remove("DATABASE_URL")
                .set("DATABASE_URL_FILE", path)
                .file(path, content)
                .error()
        };
        assert_eq!(
            Fixture::development()
                .remove("DATABASE_URL")
                .set("DATABASE_URL_FILE", path)
                .error(),
            line(
                "DATABASE_URL_FILE",
                "cannot read file \"/run/secrets/database url\""
            )
        );
        for empty in [&b""[..], b"\n", b"\r\n"] {
            assert_eq!(with_file(empty), line("DATABASE_URL_FILE", "file is empty"));
        }
        let mut large = format!("postgres://app:{MARKER}@localhost/app").into_bytes();
        large.resize(MAX_SECRET_FILE_BYTES + 1, b'a');
        assert_eq!(
            with_file(&large),
            line("DATABASE_URL_FILE", "file is larger than 8 KiB")
        );
        let mut invalid = MARKER.as_bytes().to_vec();
        invalid.extend_from_slice(&[0xff, 0xfe]);
        assert_eq!(
            with_file(&invalid),
            line("DATABASE_URL_FILE", "file is not valid UTF-8")
        );
        // Content problems use the main variable name.
        assert_eq!(
            with_file(format!("mysql://app:{MARKER}@db/app\n").as_bytes()),
            line("DATABASE_URL", MSG_DATABASE_URL)
        );
        assert_eq!(
            with_file(format!("{VALID_URL} \n").as_bytes()),
            line("DATABASE_URL", MSG_WHITESPACE)
        );
        assert_eq!(
            with_file(format!("{VALID_URL}\n\n").as_bytes()),
            line("DATABASE_URL", MSG_WHITESPACE)
        );
    }

    // covers: 0002 AC-4
    #[test]
    fn a_secret_file_of_exactly_8_kib_is_accepted() {
        let prefix = "postgres://app:";
        let suffix = "@localhost/app";
        let password = "p".repeat(MAX_SECRET_FILE_BYTES - prefix.len() - suffix.len());
        let url = format!("{prefix}{password}{suffix}");
        assert_eq!(url.len(), MAX_SECRET_FILE_BYTES);
        let config = Fixture::development()
            .remove("DATABASE_URL")
            .set("DATABASE_URL_FILE", "/run/secrets/large")
            .file("/run/secrets/large", url.as_bytes())
            .config();
        assert_eq!(config.database_url.expose(), url);
    }

    // covers: 0002 AC-4
    #[test]
    fn only_secrets_have_a_file_variant() {
        assert_eq!(
            Fixture::new(&[("APP_ENV_FILE", "/run/env"), ("DATABASE_URL", VALID_URL)])
                .file("/run/env", b"development")
                .error(),
            line("APP_ENV", MSG_REQUIRED)
        );
        for var in SCHEMA {
            assert_eq!(var.file_variant, var.secret, "{}", var.name);
        }
    }

    // covers: 0002 AC-4
    #[test]
    fn a_secret_file_path_is_printed_as_given_before_any_value_rule() {
        // The source rule (reading the file) runs before the whitespace rule,
        // and the path is never trimmed or rewritten.
        assert_eq!(
            Fixture::development()
                .remove("DATABASE_URL")
                .set("DATABASE_URL_FILE", " /run/secrets/db ")
                .error(),
            line(
                "DATABASE_URL_FILE",
                "cannot read file \" /run/secrets/db \""
            )
        );
        assert_eq!(
            Fixture::development()
                .not_unicode("DATABASE_MIGRATOR_URL_FILE")
                .error(),
            line("DATABASE_MIGRATOR_URL_FILE", MSG_UTF8)
        );
    }

    // covers: 0002 AC-4
    #[test]
    fn an_unreadable_file_value_that_looks_like_a_url_or_credential_is_not_printed() {
        for (name, value) in [
            (
                "DATABASE_URL_FILE",
                format!("postgres://app:{MARKER}@db/app"),
            ),
            ("DATABASE_URL_FILE", format!("/run/secrets/app:{MARKER}@db")),
            ("DATABASE_URL_FILE", format!("file://{MARKER}")),
            (
                "DATABASE_MIGRATOR_URL_FILE",
                format!("postgresql://m:{MARKER}@db/app"),
            ),
        ] {
            let mut fixture = Fixture::development();
            if name == "DATABASE_URL_FILE" {
                fixture.remove("DATABASE_URL");
            }
            // `error()` also asserts that the marker never appears.
            let error = fixture.set(name, &value).error();
            assert_eq!(error, line(name, MSG_FILE_PATH_HIDDEN), "{value}");
            assert!(!error.contains("://") && !error.contains('@'), "{error}");
        }
    }

    // covers: 0002 AC-4
    #[test]
    fn a_readable_file_is_used_even_when_its_path_has_an_at_sign() {
        let path = "/run/secrets/app@db/url";
        let config = Fixture::development()
            .remove("DATABASE_URL")
            .set("DATABASE_URL_FILE", path)
            .file(path, VALID_URL.as_bytes())
            .config();
        assert_eq!(config.database_url.expose(), VALID_URL);
    }

    // covers: 0002 AC-1, 0002 AC-3
    #[test]
    fn the_first_failing_rule_is_the_only_line_for_a_variable() {
        // Grammar beats the environment rule in production.
        for (name, value, message) in [
            ("COOKIE_SECURE", "FALSE", MSG_BOOL),
            ("DEV_SEED_ENABLED", "TRUE", MSG_BOOL),
            ("CORS_ALLOWED_ORIGINS", "http://app.example.com/", MSG_CORS),
            ("WEB_API_BASE_URL", "http://api.example.com/", MSG_BASE_URL),
            (
                "DATABASE_URL",
                "postgres://app:pw-marker-5f3a91@db/app?ssl_mode=disable",
                MSG_SSLMODE_ONCE,
            ),
            ("COOKIE_SECURE", " false", MSG_WHITESPACE),
        ] {
            assert_eq!(
                Fixture::strict("production").set(name, value).error(),
                line(name, message),
                "{name}={value}"
            );
        }
    }

    /// The backend section of `.env.example`: everything before the first
    /// `# --- ` line.
    fn env_example_backend_section() -> Vec<&'static str> {
        include_str!("../../../.env.example")
            .lines()
            .take_while(|line| !line.starts_with("# --- "))
            .collect()
    }

    // covers: 0002 AC-5
    #[test]
    fn schema_matches_the_backend_section_of_env_example() {
        let section = env_example_backend_section();
        let blank = section
            .iter()
            .position(|line| line.is_empty())
            .expect("a blank line ends the header");
        assert!(section[..blank].iter().all(|line| line.starts_with("# ")));
        let mut rows = &section[blank + 1..];
        while rows.last() == Some(&"") {
            rows = &rows[..rows.len() - 1];
        }

        for var in SCHEMA {
            let [comment, assignment, rest @ ..] = rows else {
                panic!("{} is missing from .env.example", var.name);
            };
            let (name, value) = assignment
                .split_once('=')
                .unwrap_or_else(|| panic!("expected NAME=value, got {assignment}"));
            assert_eq!(name, var.name, ".env.example order differs from SCHEMA");

            let comment = comment
                .strip_prefix("# ")
                .and_then(|text| text.strip_suffix('.'))
                .unwrap_or_else(|| panic!("{name}: comment must be `# <text>.`"));
            let (comment, secrecy) = comment.rsplit_once(", ").unwrap();
            let (comment, default) = comment.rsplit_once(", ").unwrap();
            let (purpose, required) = comment.rsplit_once(". ").unwrap();
            assert!(!purpose.is_empty(), "{name}: purpose is empty");
            let expected_required = if var.required { "required" } else { "optional" };
            assert_eq!(required, expected_required, "{name}");
            let expected_default = match var.default {
                None => "none",
                Some("") => "empty",
                Some(value) => value,
            };
            assert_eq!(default, format!("default {expected_default}"), "{name}");
            let expected_secrecy = if var.secret { "secret" } else { "not secret" };
            assert_eq!(secrecy, expected_secrecy, "{name}");
            if var.secret {
                assert_eq!(value, "", "{name} must have no example value");
            }

            rows = rest;
            let file_line = format!("# {name}_FILE=");
            if var.file_variant {
                let [line, rest @ ..] = rows else {
                    panic!("{file_line} is missing");
                };
                assert_eq!(*line, file_line);
                rows = rest;
            } else {
                assert_ne!(rows.first(), Some(&file_line.as_str()));
            }
        }
        assert!(
            rows.is_empty(),
            "unexpected lines after the schema: {rows:?}"
        );
    }

    // covers: 0002 AC-5
    #[test]
    fn env_example_copied_as_is_only_misses_database_url() {
        let mut fixture = Fixture::default();
        for line in env_example_backend_section() {
            if !line.starts_with('#')
                && let Some((name, value)) = line.split_once('=')
            {
                fixture.set(name, value);
            }
        }
        assert_eq!(fixture.errors(), [line("DATABASE_URL", MSG_REQUIRED)]);
    }
}
