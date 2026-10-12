# 0003. Infrastruktur PostgreSQL development

**Date**: 2026-10-12
**Status**: Proposed

## Summary

Development mendapat PostgreSQL 18.6 lewat satu perintah `bun run db:up`, yang menyalakan container dari image resmi dan baru selesai ketika database dan role aplikasinya benar benar siap. Data tersimpan di volume Docker milik project `foundation-rust` dan tetap ada setelah container dimatikan; penghapusannya hanya lewat `db:reset` yang meminta Anda mengetik nama volume. Database punya tiga identitas terpisah (admin untuk inisialisasi, migrator untuk mengubah schema, runtime untuk aplikasi) dengan password wajib di semua jalur koneksi, dan setiap run test memakai project Compose sementara sehingga data development tidak pernah tersentuh.

## Requirements

**User stories**:

- Sebagai developer, Anda mengisi password lokal di `.env`, menjalankan satu perintah, dan langsung mendapat PostgreSQL yang siap dipakai.
- Sebagai developer, data development Anda tidak hilang karena salah ketik perintah, karena test berjalan, atau karena repo lain di mesin yang sama.
- Sebagai pemilik keamanan, aplikasi hanya bisa membaca dan menulis data, tidak bisa mengubah schema, dan password salah selalu ditolak.
- Sebagai pengelola CI, test database berjalan terisolasi dan bersih setiap kali.

**Acceptance criteria**:

1. **AC-1**: `bun run db:up` menyalakan project Compose `foundation-rust` dengan satu service `postgres` dari image `postgres:18.6-trixie` dan baru selesai (status `0`) setelah healthcheck lulus, yaitu server menerima koneksi TCP dan file penanda inisialisasi ada. Port hanya dipublikasikan ke `127.0.0.1:<POSTGRES_PORT>` (default `15432`). Credential berasal dari env shell atau `.env` root yang dimuat `scripts/env-file.ts`; tidak ada credential di repo. Bila port host sudah dipakai, error Docker diteruskan dan status bukan nol.
2. **AC-2**: Untuk `db:up` dan `db:reset`, bila salah satu password infrastruktur kosong, tidak memenuhi aturan karakter dan panjang, atau sama dengan password lain, atau `POSTGRES_PORT` tidak valid, perintah keluar dengan status `1` sebelum memeriksa Docker atau membuat apa pun. Stderr berisi baris `database configuration error:` diikuti satu baris per variabel dengan teks dari tabel pesan; nilai password tidak pernah dicetak.
3. **AC-3**: Data tersimpan di volume `foundation-rust_postgres_data`. Setelah `db:down` lalu `db:up`, `system_identifier` cluster dan data yang ditulis sebelumnya tetap sama. `db:down` menghapus container dan network tetapi tidak pernah volume.
4. **AC-4**: `bun run db:reset` adalah satu satunya perintah yang menghapus volume, dan bantuannya diawali kata `DESTRUCTIVE`. Tanpa konfirmasi, dengan konfirmasi yang salah, saat input berakhir (EOF), atau saat Ctrl+C, ia keluar dengan status `1` tanpa menghapus apa pun dan pesan menyebut nama volume yang diharapkan. Di terminal interaktif ia meminta Anda mengetik nama volume; tanpa terminal, konfirmasi hanya lewat `--confirm=<nama-volume>` yang sama persis. Konfirmasi tetap diminta walaupun volume belum ada. Setelah dikonfirmasi, container, network, dan volume project dihapus lalu database dinyalakan ulang sampai sehat.
5. **AC-5**: Role dan haknya sesuai tabel di spec ini dan dibuktikan test dengan kontrol positif: `foundation_migrator` dapat membuat schema dan tabel (termasuk di `public`); `foundation_app` dapat `SELECT`, `INSERT`, `UPDATE`, `DELETE`, dan memakai sequence pada tabel buatan migrator, tetapi gagal dengan SQLSTATE `42501` untuk `CREATE SCHEMA`, `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `TRUNCATE`, `CREATE ROLE`, dan `CREATE DATABASE`; kedua role tidak punya `rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolreplication`, atau `rolbypassrls`; `PUBLIC` tidak punya hak di database `foundation`; password salah ditolak untuk koneksi TCP, termasuk `127.0.0.1` di dalam container.
6. **AC-6**: Test infrastruktur memakai project sementara bernama `foundation-test-<16 heksadesimal acak>` dengan tmpfs, port host efemeral yang dipilih Docker, dan password acak. Test tidak pernah menyalakan, menghentikan, atau menghapus project `foundation-rust`. Container, network, dan volume project sementara dihapus di akhir, termasuk saat test gagal dan saat proses menerima `SIGINT` atau `SIGTERM`.
7. **AC-7**: `.env.example` memuat bagian infrastruktur di spec ini tepat setelah bagian backend spec 0002, tanpa nilai password, dengan contoh `DATABASE_URL` dan `DATABASE_MIGRATOR_URL` lokal yang memakai role `foundation_app` dan `foundation_migrator` serta port `15432`.

## Decision

**Chosen option**: Option 1, image resmi `postgres:18.6-trixie` di satu project Compose `foundation-rust` dengan script init role, autentikasi `scram-sha-256` di semua jalur, perintah `db:*` lewat script Bun yang memuat `.env` secara eksplisit, dan project Compose sementara per run untuk test.

Satu file Compose dipakai bersama oleh development dan test; test menambah file override untuk port efemeral dan tmpfs.

**Implementation skills**: `docker-compose-patterns` (`docker/skills`, `.claude/skills/docker-compose-patterns/`)

## Feature design

### Topologi Compose

`infrastructure/compose.yaml`:

| Elemen | Nilai |
| --- | --- |
| Nama project | `name: foundation-rust` |
| Service | `postgres` (satu satunya) |
| Image | `postgres:18.6-trixie` |
| Environment | `POSTGRES_USER: foundation_admin`, `POSTGRES_DB: foundation`, `POSTGRES_PASSWORD: ${POSTGRES_ADMIN_PASSWORD:?set POSTGRES_ADMIN_PASSWORD in .env}`, `FOUNDATION_MIGRATOR_PASSWORD: ${POSTGRES_MIGRATOR_PASSWORD:?set POSTGRES_MIGRATOR_PASSWORD in .env}`, `FOUNDATION_RUNTIME_PASSWORD: ${POSTGRES_RUNTIME_PASSWORD:?set POSTGRES_RUNTIME_PASSWORD in .env}`, `POSTGRES_INITDB_ARGS: --auth-local=scram-sha-256 --auth-host=scram-sha-256` |
| Port | `127.0.0.1:${POSTGRES_PORT:-15432}:5432` |
| Volume | `postgres_data:/var/lib/postgresql` (nama efektif `foundation-rust_postgres_data`) |
| Init | `./postgres/initdb:/docker-entrypoint-initdb.d:ro` |
| Healthcheck | `test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -p 5432 -U foundation_admin -d foundation && test -f \"$$PGDATA/foundation-init.done\""]` (ditulis `$$` agar Compose tidak menginterpolasi `PGDATA` dari env host), interval 2s, timeout 3s, retries 30, start period 10s, start interval 1s |
| Stop | `stop_grace_period: 30s` |

File diawali komentar yang menjelaskan isinya dan menunjuk `bun run db:reset` sebagai satu satunya cara menghapus data. Locale dan encoding mengikuti default image (UTF8).

Override test:

- `infrastructure/compose.test.yaml`: `ports: !override ["127.0.0.1::5432"]` (Docker memilih port host efemeral).
- `infrastructure/compose.test-tmpfs.yaml`: `volumes: !reset []` dan `tmpfs: ["/var/lib/postgresql"]`.

`pg_isready` tidak melakukan autentikasi, jadi healthcheck tidak butuh password. File penanda membuktikan script init selesai; init yang gagal di tengah tidak pernah menghasilkan container sehat.

### Script init `infrastructure/postgres/initdb/10-roles.sh`

- `#!/usr/bin/env bash`, `set -euo pipefail`, mode git `100755`, akhir baris LF (dijaga `.gitattributes` `*.sh text eol=lf`).
- Menolak berjalan (status `1`, pesan menyebut nama variabel, tanpa nilai) bila `FOUNDATION_MIGRATOR_PASSWORD` atau `FOUNDATION_RUNTIME_PASSWORD` tidak cocok `^[A-Za-z0-9._~-]{16,128}$`.
- Menjalankan `psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname foundation` dengan SQL dari heredoc stdin. Password dibaca dengan `\getenv`, sehingga tidak muncul di argumen proses maupun teks SQL:

```
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
```

- Langkah terakhir: `touch "$PGDATA/foundation-init.done"`.

Default privileges hanya berlaku untuk objek yang dibuat `foundation_migrator` di database `foundation`; objek buatan role lain tidak otomatis bisa diakses `foundation_app`.

### Role dan privilege

| Role | Atribut | Hak | Dipakai oleh |
| --- | --- | --- | --- |
| `foundation_admin` | superuser (dibuat image) | Semua | Script init dan administrasi manual; tidak pernah aplikasi atau migration |
| `foundation_migrator` | `LOGIN`, tanpa superuser, createdb, createrole, replication, bypassrls | `CONNECT`, `CREATE`, `TEMPORARY` pada `foundation`; pemilik schema `public` dan objek buatannya | Perintah migration (fitur 6) |
| `foundation_app` | sama | `CONNECT` pada `foundation`; `USAGE` pada `public`; lewat default privileges: `USAGE` schema, DML tabel, `USAGE`/`SELECT` sequence buatan migrator | Backend runtime (fitur 6 dan seterusnya) |

### Variabel environment infrastruktur

| Variabel | Tujuan | Wajib | Default | Secret | Validasi |
| --- | --- | --- | --- | --- | --- |
| `POSTGRES_PORT` | Port host PostgreSQL dev | opsional | `15432` | bukan | Bilangan bulat `1024` sampai `65535` (sengaja berbeda dari `APP_PORT` yang `1` sampai `65535`) |
| `POSTGRES_ADMIN_PASSWORD` | Password `foundation_admin` | wajib untuk `up` dan `reset` | tidak ada | secret | `^[A-Za-z0-9._~-]{16,128}$` |
| `POSTGRES_MIGRATOR_PASSWORD` | Password `foundation_migrator` | sama | tidak ada | secret | Sama, dan berbeda dari password admin |
| `POSTGRES_RUNTIME_PASSWORD` | Password `foundation_app` | sama | tidak ada | secret | Sama, dan berbeda dari kedua password lain |

Nilai kosong sama dengan tidak diisi. Satu konstanta `DEFAULT_POSTGRES_PORT = 15432` diekspor dari `scripts/postgres-env.ts` dan dipakai `db.ts` serta fitur 4; test memastikan nilai itu sama dengan default di Compose.

Tabel pesan (`database configuration error:` lalu `  <NAMA>: <pesan>`, urutan tabel variabel, satu baris per variabel):

| Kondisi | Pesan |
| --- | --- |
| Password tidak diisi | `is required` |
| Password tidak cocok aturan | `must be 16 to 128 characters from A-Z, a-z, 0-9, ".", "_", "~", "-"` |
| Password sama dengan password sebelumnya di tabel | `must differ from <NAMA_LAIN>` (nama pertama yang sama) |
| Port tidak valid | `must be an integer from 1024 to 65535` |

Password hanya berlaku saat volume pertama kali diinisialisasi. Mengganti password di `.env` setelahnya tidak mengubah role; ganti lewat `ALTER ROLE` atau `db:reset`.

### Loader `scripts/env-file.ts`

Dipakai `db.ts` dan fitur 4. Fungsi `loadEnvFile(options?: { path?: string; required?: boolean }): { loaded: boolean; path: string }`:

- Path default `.env` di root repo (dihitung dari lokasi file script); path eksplisit relatif terhadap direktori kerja.
- Isi di-parse dengan `parseEnv` dari `node:util` (tanda kutip, `export`, dan komentar `#` didukung; tidak ada ekspansi `$VAR`).
- Nilai yang sudah ada di env proses dan tidak kosong menang; nilai env yang kosong diperlakukan tidak diisi sehingga nilai file berlaku.
- File default yang tidak ada: `loaded: false`, bukan error. File eksplisit atau `required: true` yang tidak ada: melempar error yang menyebut path.

### Perintah `scripts/db.ts`

Dijalankan dengan `bun --no-env-file scripts/db.ts <subperintah>`. Root `package.json` mendaftarkan:

| Task | Script |
| --- | --- |
| `db:up` | `bun --no-env-file scripts/db.ts up` |
| `db:down` | `bun --no-env-file scripts/db.ts down` |
| `db:status` | `bun --no-env-file scripts/db.ts status` |
| `db:reset` | `bun --no-env-file scripts/db.ts reset` |

Urutan setiap subperintah: muat `.env` lewat loader; untuk `up` dan `reset` validasi variabel (AC-2); periksa Docker; jalankan Compose dengan `-f infrastructure/compose.yaml` dari root repo. `COMPOSE_PROJECT_NAME` di env mengganti nama project (dipakai test).

- Pemeriksaan Docker: `docker info --format '{{.ServerVersion}}'`. Perintah tidak ditemukan: `database: docker command not found; install Docker and try again`. Status bukan nol: `database: Docker is not running; start Docker and try again`. Keduanya status `1`.
- `up`: `docker compose -f infrastructure/compose.yaml up -d --wait --wait-timeout 120 postgres`. Bila gagal: cetak `database: postgres did not become healthy; if this was its first start, run "bun run db:reset"` lalu teruskan status Compose.
- `down`: `docker compose -f infrastructure/compose.yaml down`. Untuk `down` dan `status`, password yang kosong diisi placeholder bukan secret (`unused-placeholder-for-compose`) di env anak saja, agar interpolasi `:?` tidak menghalangi.
- `status`: `docker compose -f infrastructure/compose.yaml ps postgres`, keluaran diteruskan apa adanya, status `0` walaupun service tidak berjalan.
- `reset`: nama volume diambil dari `docker compose -f infrastructure/compose.yaml config --format json` (bukan dirangkai dari string). Konfirmasi: bila `--confirm=<nilai>` ada, nilai harus sama persis (bentuk `--confirm <nilai>` dengan spasi ditolak); bila tidak ada dan `process.stdin.isTTY`, tampilkan `DESTRUCTIVE: this deletes all data in volume <nama>. Type the volume name to continue: ` lalu baca satu baris; selain itu tolak. Pesan penolakan: `database: reset cancelled; confirm with --confirm=<nama>`. Setelah konfirmasi: `down --volumes`, lalu `up` seperti di atas.
- Bantuan (`bun scripts/db.ts` tanpa subperintah atau `--help`) mencetak daftar subperintah; baris `reset` diawali `DESTRUCTIVE`.
- Status keluar: validasi, konfirmasi, dan Docker `1`; Compose diteruskan; anak yang mati karena sinyal `128 + n`.
- Fungsi murni diekspor untuk test (ekspor bernama, eksekusi utama di balik `import.meta.main`): `validateInfraEnv(env)`, `buildComposeArgs(subcommand, options)`, `confirmationAccepted(expected, answer)`.

### Harness test `scripts/testing/postgres.ts`

```
createTestEnv(): { project, passwords: { admin, migrator, runtime }, env }
startPostgres(options?: { persistent?: boolean }): Promise<TestPostgres>
TestPostgres = {
  project, port,
  passwords: { admin, migrator, runtime },
  urls: { admin, migrator, app },
  psql(role: 'admin' | 'migrator' | 'app', sql: string, options?: { password?: string }): { status, stdout, stderr },
  compose(args: string[]): { status, stdout, stderr },
  stop(): void,
}
```

- Nama project `foundation-test-<16 heksadesimal acak>`; password 32 heksadesimal acak; `stop` menolak nama yang tidak diawali `foundation-test-`.
- Env anak: salinan `process.env` tanpa `POSTGRES_*`, `COMPOSE_*`, `DATABASE_*`, dan `FOUNDATION_*`, ditambah tiga password; proses Bun anak memakai `--no-env-file`.
- Compose: `-f infrastructure/compose.yaml -f infrastructure/compose.test.yaml` ditambah `-f infrastructure/compose.test-tmpfs.yaml` kecuali `persistent: true`; `--project-name <nama>`; `up -d --wait --wait-timeout 120`. Port dibaca dari `docker compose port postgres 5432`.
- `psql` menjalankan `docker compose ... exec -T -e PGPASSWORD=<password> postgres psql -X -q -At -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -h 127.0.0.1 -U <role> -d foundation -c <sql>`.
- Pembersihan didaftarkan sebelum `up`; `stop` idempoten dan menjalankan `down --volumes --remove-orphans`. Handler `SIGINT` dan `SIGTERM` memanggil `stop` (sinkron) sekali lalu keluar `130` atau `143`, karena `bun test` tidak menjalankan `afterAll` saat menerima sinyal.
- Saat mulai, harness menghapus project `foundation-test-*` yang semua containernya dibuat lebih dari 2 jam lalu (sisa run yang dibunuh paksa), tanpa menyentuh project yang lebih muda karena bisa milik worktree lain.
- Fitur 6 dan seterusnya memakai harness yang sama; cara meneruskan URL ke `cargo test` ditetapkan fitur 6.

### Test

- Test cepat tanpa daemon Docker di `scripts/db.test.ts`: vektor `validateInfraEnv` dan tabel pesan; `confirmationAccepted`; `buildComposeArgs`; `docker compose config --format json` (tidak butuh daemon) untuk default port `15432` sama dengan `DEFAULT_POSTGRES_PORT`, port hanya `127.0.0.1`, nama volume `foundation-rust_postgres_data`, kegagalan `:?` yang menyebut variabel saat password kosong, dan override test menghasilkan port efemeral serta tmpfs; mode git `100755` untuk script init dan aturan `.gitattributes`; bagian infrastruktur `.env.example`.
- Test integrasi yang butuh Docker di `tests/integration/postgres.test.ts`, dengan batas waktu hook 180 detik. Tanpa daemon, test gagal dengan pesan yang menyebut Docker. Mencakup:
  - AC-1: `ps --format json` menunjukkan `Health` `healthy` dan setiap `Publishers[].URL` `127.0.0.1`; koneksi TCP ke port berhasil; `db:status` lewat `bun --no-env-file scripts/db.ts status` dengan `COMPOSE_PROJECT_NAME` project sementara memuat `healthy`.
  - AC-3 (`persistent: true`): migrator membuat `probe.items`, menulis satu baris; admin membaca `system_identifier` dari `pg_control_system()`; `down` lalu volume masih ada (`docker volume inspect`); `up`; identifier dan baris sama.
  - AC-4 lewat `db.ts` dengan `COMPOSE_PROJECT_NAME` project sementara dan `POSTGRES_PORT` bebas: tanpa konfirmasi, konfirmasi salah, dan stdin tertutup menghasilkan status `1` dengan volume masih ada; `--confirm=<nama>` menghasilkan status `0`, data hilang, dan service sehat.
  - AC-5: matriks hak dengan kontrol positif di schema yang sama (tabel dengan kolom identity, `INSERT` tanpa id membuktikan hak sequence), `pg_roles`, hak `PUBLIC` lewat `aclexplode(datacl)` pada `foundation` (tidak ada grantee `0`), dan password salah (status `2`, stderr memuat `password authentication failed`).
  - AC-6: `stat -f -c %T /var/lib/postgresql` di container bernilai `tmpfs`; setelah `stop`, tidak ada container, volume, atau network dengan label `com.docker.compose.project=<nama>`; proses fixture yang menyalakan harness lalu menerima `SIGTERM` tidak meninggalkan resource.
- `scripts/tsconfig.json` diperluas ke `["**/*.ts", "**/*.mjs"]`. `tests/tsconfig.json` baru meng-extend `../scripts/tsconfig.json` dengan include `["**/*.ts"]`. Task `typecheck` menjadi `tsc -p scripts/tsconfig.json && tsc -p tests/tsconfig.json && bun run --filter web typecheck`, dan assertion di `scripts/tooling.test.ts` diperbarui.

### `.env.example` bagian infrastruktur

Ditambahkan tepat setelah bagian backend spec 0002:

```
# --- Development infrastructure (spec 0003) ---
# Host port of the development PostgreSQL. optional, default 15432, not secret.
POSTGRES_PORT=15432
# Password of the superuser foundation_admin, used only for initialisation. required, default none, secret.
POSTGRES_ADMIN_PASSWORD=
# Password of the migrator role foundation_migrator. required, default none, secret.
POSTGRES_MIGRATOR_PASSWORD=
# Password of the runtime role foundation_app. required, default none, secret.
POSTGRES_RUNTIME_PASSWORD=
# Passwords use 16 to 128 characters from A-Z a-z 0-9 . _ ~ - and must all differ, for example: openssl rand -hex 24
# Matching backend URLs:
# DATABASE_URL=postgres://foundation_app:<POSTGRES_RUNTIME_PASSWORD>@127.0.0.1:15432/foundation?sslmode=disable
# DATABASE_MIGRATOR_URL=postgres://foundation_migrator:<POSTGRES_MIGRATOR_PASSWORD>@127.0.0.1:15432/foundation?sslmode=disable
```

Bila fitur 3 belum membuat `.env.example`, fitur 5 membuat file dengan bagian ini saja, dan penggabungan menempatkan bagian backend di depan.

**Data model sketch**: Tidak ada tabel aplikasi. Objek yang dibuat: database `foundation`, role `foundation_migrator` dan `foundation_app`, kepemilikan `public`, dan default privileges. Test membuat objek sementara hanya di project sementara.

**API surface**: Tidak ada endpoint HTTP; permukaannya task `db:*`, file Compose, loader env, dan harness test.

**Value sourcing**:

| Aksi | Nilai | Sumber |
| --- | --- | --- |
| Menyalakan dev | Port host | `POSTGRES_PORT`, default `DEFAULT_POSTGRES_PORT` |
| Inisialisasi cluster | Password tiga role | Variabel password dari env shell atau `.env` |
| Nama project, service, role, database | Nama | Konstanta di spec ini |
| Konfirmasi reset | Nama volume | `docker compose config --format json` |
| Project test | Nama, port, password | Acak oleh harness, port oleh Docker |

**Key invariants**:

- Compose dev hanya punya service `postgres`, port hanya `127.0.0.1`.
- Password wajib di semua jalur koneksi, termasuk loopback di dalam container.
- Tidak ada credential di repo, image, argumen proses, atau keluaran perintah.
- Hanya `db:reset` yang menghapus volume, dan hanya setelah konfirmasi nama.
- Test tidak pernah menyentuh project `foundation-rust`.

**Security model**: Admin hanya untuk inisialisasi; migrator memegang DDL, runtime hanya DML. `PUBLIC` tidak punya hak. Password diteruskan lewat `\getenv`, tidak muncul di SQL, argumen, atau log statement. Password role ada di environment container dev (terlihat lewat `docker inspect`), yang diterima untuk development lokal; staging dan production tidak memakai Compose ini.

**Configuration required**: Empat variabel infrastruktur, ditambah `DATABASE_URL` dan `DATABASE_MIGRATOR_URL` lokal dari spec 0002.

**Critical test scenarios**: lihat bagian Test; setiap AC punya skenario di sana.

## Build plan

Tracer Bullet: nyalakan database nyata lebih dulu, lalu role, perintah, harness, dan pembuktian.

1. `infrastructure/compose.yaml`, kedua override test, script init, dan `.gitattributes`; nyalakan project sementara sampai sehat, satisfies **AC-1**, **AC-5**.
2. `scripts/env-file.ts`, `scripts/postgres-env.ts`, dan `scripts/db.ts` dengan validasi, pemeriksaan Docker, konfirmasi, dan task `db:*` di root, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**.
3. Harness `scripts/testing/postgres.ts`, satisfies **AC-6**.
4. Bagian infrastruktur `.env.example`, perluasan tsconfig dan task `typecheck`, satisfies **AC-7**.
5. `scripts/db.test.ts` dan `tests/integration/postgres.test.ts`, satisfies **AC-1** sampai **AC-7**.

## Consequences

**Positive**:

- Satu perintah memberi database siap pakai dengan identitas yang sama dengan migration dan aplikasi.
- Pemisahan DDL dan DML sejak hari pertama; password salah ditolak di semua jalur.
- Test tidak bisa merusak data development atau repo lain, dan aman untuk worktree paralel.

**Negative**:

- Developer butuh Docker yang berjalan; test integrasi gagal tanpa Docker.
- Image resmi berbasis Debian bisa berbeda dari image production fitur 29, termasuk locale.
- Password ditulis dua kali di `.env` (variabel role dan URL backend).
- Setiap run test butuh beberapa detik untuk menyalakan PostgreSQL.

**Neutral**:

- Mengganti password setelah volume terbentuk butuh `ALTER ROLE` atau reset.
- Image dipin per tag; pembaruan patch berarti mengubah tag di spec ini dan Compose.

## Follow-up

- [ ] Spec fitur 4 memakai project `foundation-rust`, service `postgres`, task `db:*`, loader `scripts/env-file.ts`, dan `DEFAULT_POSTGRES_PORT`.
- [ ] Fitur 6 menetapkan schema aplikasi, `search_path`, batas statement, dan cara `cargo test` memakai harness ini.
- [ ] Fitur 29 memutuskan image production dan menyamakan locale dengan dev bila perlu.

## Rationale

Konteks, opsi, dan alasan ada di [rationale.md](rationale.md).
