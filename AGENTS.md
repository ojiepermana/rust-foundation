# Foundation Rust

## Stack

- **Bahasa / runtime**: Rust `1.99.0` (edition 2024); TypeScript `6.0.3` di Node.js `24.21.0`
- **Framework**: Axum `0.8.9` dengan Tokio `~1.53` (`apps/api`); Angular `22.2.2` CSR, standalone, zoneless (`apps/web`)
- **Database**: PostgreSQL `18.6` (dev lewat `bun run db:up`, project Compose `foundation-rust`, port `15432`)
- **Package manager / task runner**: Bun `1.4.3` untuk workspace JavaScript dan task root; Cargo untuk workspace Rust
- **Test**: `cargo test`, Vitest lewat `ng test`, `bun test` untuk `scripts/`, Playwright untuk E2E (dipasang saat E2E pertama)

Sumber: [spec 0001](docs/specs/0001-stack-audit-scaffold-workspace/index.md).

## Build approach

Tracer Bullet: membuktikan satu alur nyata lintas lapisan terlebih dahulu, lalu mempertebalnya satu segmen demi satu. (sumber: `docs/scope/index.md`)

## Commands

```bash
bun install                      # install dari bun.lock (CI: bun ci)
bun run build:api                # cargo build --locked -p api
bun run build:web                # ng build lewat guard Node
bun run test:scripts             # test tooling dan clean checkout (bun test)
bun run test:web                 # Vitest tanpa watch
cargo test --locked --workspace  # test Rust
bun run check                    # format:check, lint, typecheck, check:generated (juga dijalankan hook dan CI)
bun run db:up                    # PostgreSQL dev; juga db:down, db:status, db:reset (DESTRUCTIVE)
bun test --no-env-file ./tests/integration/postgres.test.ts  # test PostgreSQL, butuh Docker
bun run format                   # Prettier dan rustfmt menulis perbaikan
```

## Specs

Disimpan di `docs/specs/NNNN-judul/` (`index.md`, `rationale.md`, `verify.md`). Scope di `docs/scope/`, review di `docs/reviews/`.

## Rules

- Arsitektur berlapis per modul: domain, application (use case), infrastructure, transport (handler Axum). Dependensi mengarah ke dalam; domain tidak mengimpor Axum, IO Tokio, atau driver database. Struktur crate rinci ditetapkan fitur 8.
- Kode, identifier, komentar, dan pesan error berbahasa Inggris; dokumen di `docs/` berbahasa Indonesia.
- Rust: rustfmt; Clippy set default sebagai error (`-D warnings`); `unsafe_code = "forbid"` di `[workspace.lints]`.
- TypeScript strict; typescript-eslint `strictTypeChecked` dan `stylisticTypeChecked`; angular-eslint recommended plus aksesibilitas template; ekspor bernama saja (tanpa default export).
- Dependency JavaScript dipin versi tepat; jangan memakai `npm` atau `npx` di repo (gunakan `bunx`); Angular CLI selalu lewat script `bun run` agar guard Node berjalan.
- Alat atau library baru hanya lewat keputusan spec (`/architect`); jangan memasang teknologi di luar spec yang berlaku.
- File hasil generate hanya berada di root yang terdaftar di `generated-roots.json` (tambahkan root baru juga ke `.prettierignore`), dikecualikan dari lint dan format, dan ditolak `bun run check` bila tidak cocok dengan manifest. Generator wajib memanggil `writeGeneratedManifest` dari `scripts/generated.ts` setelah menulis file.
- Konfigurasi backend hanya dari env proses (spec 0002): salin `.env.example` ke `.env`; variabel baru ditambah lewat spec, tabel skema, dan bagiannya di `.env.example`. Secret tidak pernah dicetak; frontend membaca konfigurasi publik dari `/config.json` lewat `APP_CONFIG`.
- Script Bun yang butuh `.env` memuatnya lewat `scripts/env-file.ts` dengan `bun --no-env-file`; test membangun env sendiri dan tidak mewarisi `.env` developer.
- Commit memakai conventional commits (`feat(scope): ...`); sebut nomor fitur scope bila relevan.

## Tooling

Format: rustfmt dan Prettier `3.9.10` (root). Lint: Clippy, ESLint `10.12.0`, typescript-eslint `8.71.1`, angular-eslint `22.6.0`. Typecheck: `tsc` untuk `apps/web` dan `scripts/` (`@types/bun`, `@types/node` 24). Hook: `.githooks/pre-commit` lewat `core.hooksPath`, diaktifkan script `prepare` root, menjalankan `bun run check`. CI: GitHub Actions untuk fast PR checks dengan action yang dipin di spec 0001.

## Git

- integration: off

## Agent skills

- angular-developer (`~/.agents/skills/angular-developer/`, terpasang global): `angular/skills`, konvensi Angular
- [angular-new-app](.claude/skills/angular-new-app/): `angular/skills`, pembuatan aplikasi Angular lewat CLI
- [ng22-vitest](.claude/skills/ng22-vitest/): `pavananguluri/angular22-agent-skills`, test Vitest untuk Angular 22
- [docker-compose-patterns](.claude/skills/docker-compose-patterns/): `docker/skills`, Compose untuk dev (fitur 5)
- [playwright-cli](.claude/skills/playwright-cli/): `microsoft/playwright-cli`, otomasi browser dan test Playwright
- [playwright-best-practices](.claude/skills/playwright-best-practices/): `currents-dev/playwright-best-practices-skill`, praktik E2E
- [gh-fix-ci](.claude/skills/gh-fix-ci/): `openai/skills`, diagnosis check GitHub Actions yang gagal

MCP servers: Angular CLI MCP (recommended), Playwright MCP (recommended), GitHub MCP (recommended)

## Context files

- [apps/api/AGENTS.md](apps/api/AGENTS.md): binary Axum dan test Rust
- [apps/web/AGENTS.md](apps/web/AGENTS.md): workspace Angular CLI dan guard Node
- [infrastructure/AGENTS.md](infrastructure/AGENTS.md): Compose PostgreSQL development, role database, dan harness test

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
