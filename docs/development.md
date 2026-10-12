# Development

Panduan task root dan lifecycle development Foundation Rust (spec [0004](specs/0004-task-root-lifecycle-development/index.md)). Semua task dijalankan dari root dengan `bun run <task>`.

## Install

Jalankan `bun install` sekali setelah clone; perintah ini memasang dependency dari `bun.lock` dan, lewat script `prepare`, mengaktifkan hook git di `.githooks`. CI memakai `bun ci`, yang menolak berjalan bila `bun.lock` perlu berubah. Install bukan script di `package.json`, jadi tidak ada di tabel di bawah. Jangan memakai `npm` atau `npx` di repo ini; gunakan `bunx`.

Sebelum `dev`, `run:api`, atau `db:*`, salin `.env.example` menjadi `.env` lalu isi nilainya. Semua script Bun memakai `--no-env-file` dan memuat `.env` secara eksplisit lewat `scripts/env-file.ts`.

## Tersedia

Prasyarat: `-` tanpa syarat selain alat terpasang, `env` butuh `.env` lokal, `docker` butuh Docker berjalan.

| Task | Perintah | Tujuan | Prasyarat | Pemilik |
| --- | --- | --- | --- | --- |
| `prepare` | `bun --no-env-file scripts/install-hooks.ts` | Mengaktifkan hook git; dijalankan otomatis oleh `bun install`. | - | Fitur 2 |
| `dev` | `bun --no-env-file scripts/dev.ts` | Menjalankan dev server Angular, backend, dan proxy `/api` dengan reload backend. | env | Fitur 4 |
| `build` | `bun run build:api && bun run build:web` | Build debug backend dan build production frontend. | - | Fitur 4 |
| `build:api` | `cargo build --locked -p api` | Build backend. | - | Fitur 1 |
| `build:web` | `bun run --filter web build` | Build frontend lewat guard Node. | - | Fitur 1 |
| `run:api` | `bun --no-env-file scripts/run-api.ts` | Menjalankan backend saja dengan `.env`. | env | Fitur 4 |
| `check` | `bun run format:check && bun run lint && bun run typecheck && bun run check:generated` | Semua pemeriksaan cepat; juga dijalankan hook pre-commit dan CI. | - | Fitur 2 |
| `format` | `prettier --write . && cargo fmt --all` | Merapikan format semua file. | - | Fitur 2 |
| `format:check` | `prettier --check . && cargo fmt --all --check` | Memeriksa format tanpa menulis file. | - | Fitur 2 |
| `lint` | `eslint . --max-warnings 0 && cargo clippy --locked --workspace --all-targets -- -D warnings` | ESLint tanpa toleransi warning dan Clippy. | - | Fitur 2 |
| `typecheck` | `tsc -p scripts/tsconfig.json && tsc -p tests/tsconfig.json && bun run --filter web typecheck` | Typecheck script tooling, test integrasi, dan web. | - | Fitur 2 dan 5 |
| `check:generated` | `bun --no-env-file scripts/check-generated.ts` | Menolak file hasil generate yang diubah tangan. | - | Fitur 2 |
| `test` | `bun run test:scripts && bun run test:web && bun run test:api` | Semua test cepat, tanpa Docker dan tanpa build penuh. | - | Fitur 4 |
| `test:scripts` | `bun test --no-env-file` | Test tooling di `scripts/`. | - | Fitur 1 |
| `test:web` | `bun run --filter web test` | Unit test Angular dengan Vitest. | - | Fitur 1 |
| `test:api` | `cargo test --locked --workspace` | Test Rust. | - | Fitur 4 |
| `test:integration` | `bun test --no-env-file ./tests/integration` | Test lambat: clean checkout, lifecycle dev, dan PostgreSQL. | docker | Fitur 4 |
| `db:up` | `bun --no-env-file scripts/db.ts up` | Menyalakan PostgreSQL development sampai sehat. | env, docker | Fitur 5 |
| `db:down` | `bun --no-env-file scripts/db.ts down` | Menghentikan PostgreSQL development; volume tetap. | env, docker | Fitur 5 |
| `db:status` | `bun --no-env-file scripts/db.ts status` | Status service PostgreSQL development. | env, docker | Fitur 5 |
| `db:reset` | `bun --no-env-file scripts/db.ts reset` | DESTRUCTIVE: menghapus data PostgreSQL development setelah konfirmasi nama volume. | env, docker | Fitur 5 |

## Dicadangkan

Nama task untuk fitur berikutnya. Fitur pemilik memindahkan barisnya ke *Tersedia* saat mendaftarkan script.

| Task | Tujuan | Pemilik |
| --- | --- | --- |
| `test:e2e` | E2E Playwright. | Fitur 18 dan 24 |
| `contract:generate` | Generate client Angular dari kontrak. | Fitur 11 sampai 13 |
| `contract:check` | Cek drift kontrak dan client. | Fitur 11 sampai 13 |
| `db:migrate` | Menerapkan migration. | Fitur 6 |
| `db:migrate:status` | Melihat status migration. | Fitur 6 |
| `db:seed` | Seed development. | Fitur 17 |
| `build:profile-a` | Build Profil A. | Fitur 30 |
| `smoke:profile-a` | Smoke test Profil A. | Fitur 30 |
| `build:profile-b` | Build Profil B. | Fitur 31 |
| `smoke:profile-b` | Smoke test Profil B. | Fitur 31 |

## Lifecycle `bun run dev`

- `dev` membaca `.env` root (atau `--env-file <path>`), memeriksa variabel dan port, lalu menyalakan backend di `APP_HOST:APP_PORT` dan dev server Angular di `127.0.0.1:<WEB_DEV_PORT>` (default `4200`). Request ke `/api` dan `/api/...` diteruskan ke backend tanpa mengubah path.
- Hentikan dengan Ctrl+C atau ketik `q` lalu Enter. Ctrl+C kedua lebih dari 1,5 detik setelah yang pertama memaksa penghentian.
- Perubahan di `apps/api`, `crates`, `Cargo.toml`, atau `Cargo.lock` memicu build ulang; bila build gagal, backend lama tetap berjalan.
- Log setiap layanan diberi awalan `[web]`, `[api]`, atau `[dev]`, dan disalin ke `.dev/logs/web.log` serta `.dev/logs/api.log`.
- `dev` tidak menyalakan PostgreSQL; jalankan `bun run db:up` bila butuh database.
- Perubahan `.env` atau `apps/web/proxy.conf.mjs` baru berlaku setelah `dev` dijalankan ulang.
- Bila backend tidak hidup, proxy menjawab 502 untuk `/api`.
- `test:api` menjalankan test kerangka di port tetap `3000`; hentikan `dev` dulu bila `APP_PORT` di `.env` juga `3000`.
- Supervisor yang dibunuh paksa (`SIGKILL`) bisa meninggalkan proses anak; `dev` berikutnya melaporkannya sebagai port yang terpakai.
