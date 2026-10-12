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

### Changed

- `unsafe_code` dilarang (`forbid`) di seluruh workspace Rust, file scaffold Angular dirapikan Prettier, dan konfigurasi Prettier pindah dari `apps/web` ke root (fitur 2).

### Security

- `npm install`, `npx`, dan `npm exec` ditolak di dalam repo lewat `devEngines`, sehingga tidak ada lockfile npm yang bisa muncul tanpa sengaja; lifecycle script dependency tetap diblokir sesuai default Bun, dan analytics Angular CLI dimatikan.
