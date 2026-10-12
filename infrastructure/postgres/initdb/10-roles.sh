#!/usr/bin/env bash
# Creates the migrator and runtime roles of the development database (spec 0003).
# The official image runs this once, only while initialising an empty data directory.
# Passwords are read with \getenv, so they never appear in process arguments or SQL text.
set -euo pipefail

password_pattern='^[A-Za-z0-9._~-]{16,128}$'
for name in FOUNDATION_MIGRATOR_PASSWORD FOUNDATION_RUNTIME_PASSWORD; do
  if [[ ! "${!name:-}" =~ $password_pattern ]]; then
    echo "10-roles.sh: ${name} must be 16 to 128 characters from A-Z, a-z, 0-9, \".\", \"_\", \"~\", \"-\"" >&2
    exit 1
  fi
done

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname foundation <<'SQL'
SET log_min_error_statement = 'panic';
SET log_statement = 'none';
\getenv migrator_password FOUNDATION_MIGRATOR_PASSWORD
\getenv runtime_password FOUNDATION_RUNTIME_PASSWORD
CREATE ROLE foundation_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'migrator_password';
CREATE ROLE foundation_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_password';
REVOKE ALL ON DATABASE foundation FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE foundation TO foundation_migrator;
GRANT CONNECT ON DATABASE foundation TO foundation_app;
ALTER SCHEMA public OWNER TO foundation_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO foundation_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foundation_migrator GRANT USAGE ON SCHEMAS TO foundation_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foundation_migrator GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO foundation_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foundation_migrator GRANT USAGE, SELECT ON SEQUENCES TO foundation_app;
SQL

touch "$PGDATA/foundation-init.done"
