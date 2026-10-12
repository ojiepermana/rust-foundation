# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Monorepo dengan Cargo Workspace (Rust `1.99.0`, edition 2024, resolver 3) dan Bun Workspace (Bun `1.4.3` sebagai package manager dan task runner), dengan `rust-toolchain.toml`, `.nvmrc` (Node `24.21.0`), `packageManager`, serta dua lockfile tunggal `bun.lock` dan `Cargo.lock` di root (spec 0001).
- Kerangka API `apps/api`: binary Axum `0.8.9` di atas Tokio `1.53` LTS yang listen di alamat sementara `127.0.0.1:3000`, menjawab 404 untuk semua path, dan keluar dengan pesan yang menyebut alamat bila port sudah dipakai (spec 0001).
- Kerangka web `apps/web`: aplikasi Angular `22.2.2` CSR yang standalone, zoneless, dan strict, dengan build statis di `apps/web/dist/web/browser/` serta unit test Vitest `5.0.3` dan jsdom yang berjalan tanpa watch (spec 0001).
- Guard `scripts/guard-node.mjs` di depan setiap script Angular yang menghentikan build dan test bila berjalan di runtime Bun atau di Node yang tidak sesuai `.nvmrc` dan `engines.node` (spec 0001).
- Script root `build:web`, `test:web`, `build:api`, `run:api`, dan `test:scripts` sebagai pintu task sementara sampai fitur 4 menetapkan antarmuka task lengkap.
- Suite test fitur 1: 53 test `bun test` untuk guard, pin versi tepat, satu lockfile, penolakan `npm install` dengan `EBADDEVENGINES`, invarian workspace, dan clean checkout yang membangun ulang semuanya dari salinan bersih; satu test integrasi Rust yang menjalankan binary API asli lewat HTTP mentah.
- Spec 0001 berisi matriks audit toolchain per 2026-10-12, decision log dengan status setiap keputusan wajib brief, dan draft ADR-0001 sampai ADR-0006; [review independen](docs/reviews/2026-10-12-main-workspace-scaffold.md) memberi Approve with nits, dan temuan minornya sudah ditindaklanjuti kecuali pemisahan test cepat dan lambat yang diserahkan ke fitur 4.
- Konteks agent di `AGENTS.md` root (stack, build approach, aturan, tooling, git `off`, Agent Skill) dan di `apps/api/AGENTS.md` serta `apps/web/AGENTS.md`, dengan pointer `CLAUDE.md` di setiap level (fitur 2).
- Task `bun run check` yang menjalankan Prettier dan rustfmt (`format:check`), ESLint strict dengan angular-eslint dan aksesibilitas template tanpa toleransi warning serta Clippy `-D warnings` (`lint`), typecheck `scripts/` dan `apps/web` (`typecheck`), dan penjaga file hasil generate (`check:generated`); `bun run format` merapikan semuanya (fitur 2).
- Hook pre-commit git native di `.githooks/pre-commit` yang menjalankan `bun run check`, diaktifkan otomatis oleh script `prepare` saat `bun install` (fitur 2).
- Workflow GitHub Actions `.github/workflows/ci.yml` untuk fast PR checks yang memasang Node dari `.nvmrc`, Bun dari `packageManager`, Rust dari `rust-toolchain.toml`, lalu menjalankan task root yang sama dengan developer (fitur 2).
- File hasil generate hanya boleh berada di root yang terdaftar di `generated-roots.json`; root itu dikecualikan dari lint dan format, dan `check:generated` menolak file yang ditambah, diubah, atau dihapus dengan tangan, termasuk symlink, berdasarkan manifest SHA-256 yang ditulis generator (fitur 2).
- Suite test fitur 2 untuk penjaga file generate, invarian tooling dan CI, serta clean checkout yang kini juga membuktikan `bun run check` lulus dan hook menolak commit yang melanggar format; [review independen](docs/reviews/2026-10-12-main-tooling.md) memberi Approve with nits.
- Agent Skill proyek di `.claude/skills/` (docker compose patterns, playwright cli, playwright best practices, angular new app, ng22 vitest, gh fix ci) yang tercatat di `skills-lock.json`.
- PostgreSQL `18.6` untuk development lewat `bun run db:up`: project Compose `foundation-rust` (`infrastructure/compose.yaml`) dengan satu service `postgres` dari image `postgres:18.6-trixie`, port hanya di `127.0.0.1:15432` (bisa diganti lewat `POSTGRES_PORT`), dan perintah yang baru selesai setelah server menerima koneksi TCP dan script init selesai (fitur 5).
- Task `db:down` (menghapus container dan network, volume `foundation-rust_postgres_data` tetap ada), `db:status`, dan `db:reset`, satu satunya perintah yang menghapus data. Reset meminta Anda mengetik nama volume di terminal, atau `--confirm=<nama volume>` yang sama persis; selain itu ia batal tanpa menghapus apa pun, termasuk saat Ctrl+C, akhir input, atau tanpa terminal (fitur 5).
- Tiga identitas database dari script init `infrastructure/postgres/initdb/10-roles.sh`: `foundation_admin` hanya untuk inisialisasi, `foundation_migrator` pemilik schema `public` yang memegang DDL, dan `foundation_app` yang hanya mendapat DML dan sequence lewat default privileges; `PUBLIC` tidak punya hak di database `foundation` maupun schema `public` (fitur 5).
- Validasi `POSTGRES_PORT`, `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_MIGRATOR_PASSWORD`, dan `POSTGRES_RUNTIME_PASSWORD` untuk `db:up` dan `db:reset` sebelum Docker disentuh, dengan satu baris pesan per variabel tanpa nilai password. Loader `scripts/env-file.ts` memuat `.env` root secara eksplisit (nilai env shell yang tidak kosong menang), konstanta `DEFAULT_POSTGRES_PORT` ada di `scripts/postgres-env.ts`, dan `.env.example` mendapat bagian infrastruktur spec 0003 (fitur 5).
- Harness test `scripts/testing/postgres.ts` yang menyalakan project sementara `foundation-test-<16 heksadesimal>` dengan tmpfs, port efemeral, dan password acak, lalu menghapus container, network, dan volume di akhir, juga saat test gagal atau proses menerima `SIGINT` atau `SIGTERM`; test tidak pernah menyentuh project `foundation-rust` (fitur 5).
- Suite test fitur 5: `scripts/db.test.ts` (110 test tanpa daemon Docker, termasuk reset interaktif lewat terminal semu dan command `docker` palsu) dan `tests/integration/postgres.test.ts` (40 test dengan Docker, lewat `bun test --no-env-file ./tests/integration/postgres.test.ts`) untuk matriks hak role, persistensi data, reset, dan pembersihan; [review independen](docs/reviews/2026-10-12-feat-fitur-5-postgresql.md) memberi Approve with nits, dan temuan minornya sudah ditindaklanjuti kecuali aturan `.gitignore` untuk `.env` yang menjadi bagian fitur 3.

### Changed

- `unsafe_code` dilarang (`forbid`) di seluruh workspace Rust, file scaffold Angular dirapikan Prettier, dan konfigurasi Prettier pindah dari `apps/web` ke root (fitur 2).
- Task `typecheck` kini juga memeriksa `tests/` lewat `tests/tsconfig.json`, `scripts/tsconfig.json` mencakup subfolder, dan `bun run test:scripts` kini membutuhkan CLI `docker` dengan plugin Compose, tanpa perlu daemon (fitur 5).

### Security

- `npm install`, `npx`, dan `npm exec` ditolak di dalam repo lewat `devEngines`, sehingga tidak ada lockfile npm yang bisa muncul tanpa sengaja; lifecycle script dependency tetap diblokir sesuai default Bun, dan analytics Angular CLI dimatikan.
- PostgreSQL development mewajibkan password `scram-sha-256` di semua jalur koneksi, termasuk socket lokal dan loopback di dalam container yang di image resmi memakai `trust`, sehingga password salah selalu ditolak. Password role dibaca script init lewat `\getenv`, sehingga tidak muncul di argumen proses, teks SQL script, maupun log server (fitur 5).
