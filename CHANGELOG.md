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
- Konfigurasi backend dari environment proses: `apps/api` membaca dan memvalidasi seluruh skema (`APP_ENV`, `APP_HOST`, `APP_PORT`, `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `COOKIE_SECURE`, `CORS_ALLOWED_ORIGINS`, `DEV_SEED_ENABLED`, `WEB_API_BASE_URL`) sekali saat start, sebelum listener dibuka. Bila ada masalah, proses keluar dengan status `78`, stdout kosong, dan stderr berisi `configuration error:` lalu satu baris per variabel dalam urutan skema, tanpa panic dan tanpa menyalin nilai (fitur 3, spec 0002).
- Secret database boleh diisi lewat `DATABASE_URL_FILE` dan `DATABASE_MIGRATOR_URL_FILE` (paling besar 8 KiB, UTF-8, satu baris baru di akhir dibuang); mengisi variabel dan file sekaligus ditolak, dan masalah file menyebut nama variabel dan path, bukan isinya (fitur 3).
- `.env.example` di root berisi bagian backend yang sama persis dengan spec 0002, tanpa nilai secret; test Rust menolak bila skema di kode dan file itu berbeda (fitur 3).
- Konfigurasi runtime frontend: aplikasi Angular mengambil `/config.json` (tanpa cache, batas waktu 5 detik) sebelum bootstrap dan menyediakan `apiBaseUrl` lewat token `APP_CONFIG`. File default `{ "apiBaseUrl": "/api" }` ikut ke output build, dan mengganti file itu mengubah nilainya tanpa build ulang. Bila file tidak bisa diambil atau tidak valid, aplikasi tidak bootstrap dan `app-root` menampilkan pesan dengan `role="alert"` (fitur 3).
- Suite test fitur 3: unit test Rust untuk tabel pesan, grammar URL database dan origin CORS, aturan lingkungan, `<NAMA>_FILE`, redaksi, dan sinkronisasi `.env.example`; test proses yang menjalankan binary asli dengan environment bersih dan port bebas; Vitest untuk validator dan bootstrap dengan vektor URL yang sama dengan sisi Rust; `bun test` untuk aturan git `.env` dan `childEnv`; serta clean checkout yang membangun ulang web dengan URL database penanda lalu memindai seluruh bundle. [Review independen](docs/reviews/2026-10-12-feat-fitur-3-konfigurasi.md) memberi Approve with nits.

### Changed

- `unsafe_code` dilarang (`forbid`) di seluruh workspace Rust, file scaffold Angular dirapikan Prettier, dan konfigurasi Prettier pindah dari `apps/web` ke root (fitur 2).
- Alamat API tidak lagi tetap: default tetap `127.0.0.1:3000`, tetapi `APP_HOST` dan `APP_PORT` menggantinya, dan baris start mencetak alamat yang benar benar di-bind (IPv6 dalam kurung siku). `cargo run` dan `bun run run:api` kini butuh minimal `APP_ENV` dan `DATABASE_URL`; tanpa itu keduanya keluar dengan status `78` (fitur 3).

### Security

- `npm install`, `npx`, dan `npm exec` ditolak di dalam repo lewat `devEngines`, sehingga tidak ada lockfile npm yang bisa muncul tanpa sengaja; lifecycle script dependency tetap diblokir sesuai default Bun, dan analytics Angular CLI dimatikan.
- Staging dan production menolak start dengan `COOKIE_SECURE=false`, `DEV_SEED_ENABLED=true`, origin CORS `http://`, `WEB_API_BASE_URL` berupa URL `http://`, atau URL database tanpa tepat satu `sslmode` bernilai `require`, `verify-ca`, atau `verify-full`; wildcard `*` di `CORS_ALLOWED_ORIGINS` ditolak di semua lingkungan (fitur 3).
- Nilai `DATABASE_URL` dan `DATABASE_MIGRATOR_URL`, termasuk password, tidak dicetak ke stdout atau stderr, dan representasi debug konfigurasi menampilkan `[redacted]`. `.env` dan `.env.*` diabaikan git kecuali `.env.example`, dan bundle Angular tidak memuat konfigurasi backend (fitur 3).
