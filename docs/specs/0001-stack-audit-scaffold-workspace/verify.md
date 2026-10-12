# Verify: Stack, audit, dan scaffold workspace · spec 0001 · updated 2026-10-12

_Langkah diturunkan dari acceptance criteria spec 0001. `/check verify` menjalankannya; `/test` mengunci yang tahan lama._

## Commands

- [x] Buka `rationale.md`, pastikan matriks punya delapan kolom (komponen, versi terpasang, versi usulan, status dukungan, kebutuhan kompatibilitas, sumber, status verifikasi, tindakan), setiap baris punya sumber, dan baris `belum diverifikasi` tidak memuat angka versi → AC-1
- [x] Buka decision log di `index.md`, pastikan setiap keputusan wajib brief bagian 4 (data access dan migration, sumber OpenAPI, generator client, auth dan sesi, RBAC, struktur modul, styling, test runner, CI, profil deployment) punya status sah, kandidat default bila belum diputuskan, dan pemilik; draft ADR ada di `rationale.md` → AC-2
- [x] `cat rust-toolchain.toml .nvmrc` dan baca `packageManager` di `package.json` → `1.99.0` dengan `rustfmt` dan `clippy`, `24.21.0`, `bun@1.4.3` → AC-3
- [x] Periksa setiap `package.json` di luar `node_modules` → tidak ada versi dependency dengan `^`, `~`, `*`, `x`, rentang, atau tag → AC-3
- [x] `git ls-files --cached --others --exclude-standard` lalu cari lockfile package manager → hanya `bun.lock` dan `Cargo.lock` → AC-4
- [x] `npm install` pada salinan `package.json` root dan `apps/web/package.json` → gagal dengan `EBADDEVENGINES` yang menyebut `bun`, tidak ada `package-lock.json` → AC-4
- [x] Baca `Cargo.toml` root dan `apps/api/Cargo.toml` → workspace virtual, `resolver = "3"`, member `apps/api`, `version`, `edition = "2024"`, `rust-version = "1.99"`; `apps/web` tanpa lockfile, `.gitignore`, atau `packageManager` → AC-5
- [x] Salin file dari `git ls-files -z --cached --others --exclude-standard` ke direktori sementara, `git init`, `git add -A`, commit, lalu `bun ci`, `cargo build --locked --workspace`, `bun run build:web` → semua berhasil dan `git status --porcelain` kosong → AC-6
- [x] Pastikan port 3000 bebas, `bun run run:api` → mencetak `api listening on http://127.0.0.1:3000` → AC-7
- [x] `curl -X GET` dan `curl -X POST` ke path acak di `http://127.0.0.1:3000` → 404 → AC-7
- [x] Jalankan `./target/debug/api` kedua saat yang pertama hidup → status bukan nol dan pesan menyebut `127.0.0.1:3000` → AC-7
- [x] `bun run build:web` → `apps/web/dist/web/browser/index.html` ada dan `apps/web/dist/web/server` tidak ada → AC-8
- [x] `bun run test:web` → `app.spec.ts` lulus dengan Vitest tanpa watch → AC-8
- [x] Cari `zone.js`, `NgModule`, `provideZoneChangeDetection`, `server`, `ssr`, `prerender` di `apps/web/src`, `angular.json`, dan `package.json`; cari entri paket `zone.js@` di `bun.lock` dan folder `node_modules/zone.js`; baca `"strict": true` di `apps/web/tsconfig.json` → tidak ada temuan dan strict aktif → AC-8
- [x] `bun run build:web` → lulus (guard di Node) → AC-9
- [x] `bun --bun run --filter web build` → gagal status 1 dengan `guard-node:` yang menyebut runtime Bun → AC-9
- [x] `bun run build:web` dengan PATH yang hanya berisi folder Bun, `/usr/bin`, dan `/bin` → gagal dengan pesan guard yang sama → AC-9

## Acceptance-criteria coverage

- AC-1 matriks audit · AC-2 decision log dan ADR · AC-3 pin dan versi tepat · AC-4 satu lockfile dan penolakan npm · AC-5 tata letak workspace · AC-6 clean checkout · AC-7 kerangka API · AC-8 kerangka web · AC-9 guard runtime
