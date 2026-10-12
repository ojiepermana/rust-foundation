# Bagian 1: Fondasi workspace dan toolchain

Milestone M0 dan M1 pada brief: audit versi, keputusan arsitektur payung, scaffold kedua workspace, konvensi dan tooling, konfigurasi tervalidasi, task root, dan database development. Kembali ke [ringkasan scope](index.md).

## Fondasi (M0, M1)

### 1. Stack, audit, dan scaffold workspace · done

Audit versi dan dukungan (Angular 22 atau lebih baru yang stabil, Node.js, TypeScript, RxJS, Bun, Rust stable, Axum, Tokio, PostgreSQL, Docker) dengan sumber resmi dan tanggal pemeriksaan, lalu putuskan tata letak monorepo Cargo Workspace dan Bun Workspace, strategi pinning dan lockfile tunggal, test runner, dan provider CI. Spec ini menjadi payung; keputusan akses data, kontrak, generator, auth, RBAC, styling, dan profil deployment dibawa oleh fitur pemiliknya. Bila Angular 22 belum stabil atau tidak kompatibel, spec menyatakan blocker dan pilihan, bukan menurunkan requirement.

**Selesai ketika:** matriks audit (komponen, versi terpasang, versi usulan, status dukungan, kebutuhan kompatibilitas, sumber, status verifikasi, tindakan) tercatat tanpa angka yang belum diverifikasi; decision log dan ADR awal ada dengan status `diusulkan`, `terverifikasi`, atau `menunggu keputusan`; clean checkout memasang dependency dari lockfile yang tersimpan di repo dan membangun kerangka kosong `apps/api` serta `apps/web` secara reproducible; Bun berperan sebagai package manager dan task runner sementara Angular CLI, build, dan test berjalan pada Node.js versi yang didukung Angular.

**Spec:** [0001](../specs/0001-stack-audit-scaffold-workspace/index.md)

- [x] Audit toolchain dan putuskan stack (spec): `/architect stack, audit, dan scaffold workspace`
- [x] Scaffold dari keputusan: `/develop stack, audit, dan scaffold workspace` (code in `apps/api/`, `apps/web/`, `scripts/guard-node.mjs`, manifest root)
- [x] Verifikasi: `/check verify stack, audit, dan scaffold workspace`
- [x] Pastikan kerangka terbangun dari clean checkout: `/test`
- [x] Review (model baru): `/check review stack, audit, dan scaffold workspace` (`docs/reviews/2026-10-12-main-workspace-scaffold.md`, Approve with nits)
- [x] Dokumentasikan: `/document stack, audit, dan scaffold workspace` (`CHANGELOG.md`)

### 2. Standar koding dan tooling · done

Tangkap konvensi nyata dari scaffold ke `AGENTS.md` root (gaya Rust dan TypeScript, aturan batas modul, perlakuan file hasil generate), lalu pasang format, Clippy, TypeScript strict, lint, hook `pre-commit`, dan CI dasar untuk fast PR checks.

**Selesai ketika:** `AGENTS.md` root mencerminkan stack nyata; format, Clippy, typecheck, dan lint berjalan bersih pada clean checkout dan pada CI dasar; file hasil generate dikecualikan dari lint dan ditolak bila diedit manual.

- [x] Tangkap konvensi dan pilihan tooling: `/audit` (`AGENTS.md`, `apps/api/AGENTS.md`, `apps/web/AGENTS.md`)
- [x] Pasang tooling: `/develop tooling` (code in `eslint.config.mjs`, `.prettierrc`, `.githooks/`, `.github/workflows/ci.yml`, `scripts/generated.ts`, `scripts/check-generated.ts`)
- [x] Verifikasi: `/check verify tooling` (salinan bersih lokal dan [run CI GitHub 38226987025](https://github.com/ojiepermana/rust-foundation/actions/runs/38226987025) lulus)
- [x] Pastikan berjalan bersih: `/test` (`scripts/generated.test.ts`, `scripts/tooling.test.ts`, `scripts/clean-checkout.test.ts`)
- [x] Review (model baru): `/check review tooling` (`docs/reviews/2026-10-12-main-tooling.md`, Approve with nits)
- [x] Dokumentasikan: `/document tooling` (`CHANGELOG.md`)

### 3. Konfigurasi tervalidasi dan environment · in-progress

Skema konfigurasi backend (nama variabel, tujuan, wajib atau opsional, default aman, secret atau bukan, aturan validasi, kebutuhan restart), precedence, pemisahan dev, test, staging, dan production, fail fast, `.env.example` tanpa secret, dan pemeriksaan misconfiguration production. Frontend memisahkan konfigurasi saat build dari runtime; semua yang dikirim ke browser bersifat publik, termasuk API base URL untuk kedua profil deployment.

**Selesai ketika:** aplikasi menolak start dengan pesan jelas saat variabel wajib hilang atau tidak valid; mode production menolak nilai tidak aman (misalnya cookie tanpa Secure, CORS wildcard, atau dev seed aktif); `.env.example` lengkap tanpa nilai secret; nilai secret tidak pernah muncul di log; API base URL frontend dapat diatur per profil tanpa secret di bundle Angular.

**Spec:** [0002](../specs/0002-konfigurasi-tervalidasi-environment/index.md)

- [x] Rancang skema konfigurasi (spec): `/architect konfigurasi tervalidasi dan environment`
- [x] Build it: `/develop konfigurasi tervalidasi dan environment` (code in `apps/api/src/config.rs`, `apps/api/src/main.rs`, `apps/web/src/app/config/`, `apps/web/public/config.json`, `.env.example`)
  - [x] Pemuat konfigurasi backend, tabel pesan, status 78, dan bind dari konfigurasi (AC-1, AC-2)
  - [x] Grammar URL, aturan lingkungan, secret teredaksi, dan `<NAMA>_FILE` (AC-3, AC-4)
  - [x] `.env.example` bagian backend dan aturan git (AC-5)
  - [x] `config.json` runtime dan bootstrap Angular (AC-6, AC-7)
- [x] Verifikasi: `/check verify konfigurasi tervalidasi dan environment` (binary asli dan browser lokal; 37 langkah di `verify.md` lulus)
- [x] Test: `/test konfigurasi tervalidasi dan environment` (`apps/api/src/config.rs`, `apps/api/tests/config.rs`, `apps/web/src/app/config/app-config.spec.ts`, `scripts/env-example.test.ts`, `scripts/clean-checkout.test.ts`)
- [x] Review (model baru): `/check review konfigurasi tervalidasi dan environment` (`docs/reviews/2026-10-12-feat-fitur-3-konfigurasi.md`, Approve with nits)
- [x] Dokumentasikan: `/document konfigurasi tervalidasi dan environment` (`CHANGELOG.md`)

### 4. Task root dan lifecycle development · in-progress

Satu antarmuka task di root yang mengoordinasikan Cargo Workspace dan Bun Workspace: install, dev, build, lint, test, E2E, generate dan check kontrak, migrate dan status, seed dev, lifecycle Compose, serta build dan smoke kedua profil. Lifecycle dev menjalankan frontend dan backend bersama proxy, hot reload, log terpisah, shutdown child process, deteksi konflik port, dan dukungan lintas OS tanpa layanan production.

**Selesai ketika:** daftar task root terdokumentasi dan setiap task berjalan dari clean checkout; satu perintah dev menjalankan frontend, backend, dan proxy lalu menghentikan semuanya bersih saat Ctrl+C; konflik port dilaporkan jelas; hanya ada satu lockfile package manager di repo.

**Spec:** [0004](../specs/0004-task-root-lifecycle-development/index.md)

- [x] Rancang antarmuka task dan lifecycle (spec): `/architect task root dan lifecycle development`
- [ ] Build it: `/develop task root dan lifecycle development`
  - [ ] Supervisor `dev` dengan preflight, build pertama, backend, dev server, dan proxy (AC-3, AC-4, AC-8)
  - [ ] Penghentian lintas OS dan pemicu berhenti (AC-7)
  - [ ] Watcher polling, reload, dan log terpisah (AC-5, AC-6)
  - [ ] Katalog task, script root, dan tata letak test (AC-1, AC-2)
  - [ ] Portabilitas test, test lifecycle, dan CI tiga OS (AC-9)
- [ ] Verifikasi: `/check verify task root dan lifecycle development`
- [ ] Test: `/test task root dan lifecycle development`
- [ ] Review (model baru): `/check review task root dan lifecycle development`
- [ ] Dokumentasikan: `/document task root dan lifecycle development`

### 5. Infrastruktur PostgreSQL development · in-progress

Compose untuk development dengan PostgreSQL dan service minimum, volume persisten, prosedur reset yang ditandai destruktif, serta identitas database terpisah untuk migrator dan runtime dengan privilege minimum. Database test terisolasi dari data dev.

**Selesai ketika:** satu perintah menyediakan PostgreSQL siap koneksi dengan credential dari environment lokal, bukan dari repo; reset destruktif memerlukan konfirmasi eksplisit; role migrator dan runtime berbeda privilege dan dibuktikan oleh test; test integrasi memakai database terisolasi tanpa menyentuh data dev.

**Spec:** [0003](../specs/0003-infrastruktur-postgresql-development/index.md)

- [x] Rancang topologi dev dan role database (spec): `/architect infrastruktur PostgreSQL development`
- [ ] Build it: `/develop infrastruktur PostgreSQL development`
  - [ ] Compose, override test, dan script init role (AC-1, AC-5)
  - [ ] Loader env, perintah `db:*`, validasi, dan konfirmasi reset (AC-1 sampai AC-4)
  - [ ] Harness test sementara dan pembersihan (AC-6)
  - [ ] `.env.example` bagian infrastruktur dan tsconfig test (AC-7)
- [ ] Verifikasi: `/check verify infrastruktur PostgreSQL development`
- [ ] Test: `/test infrastruktur PostgreSQL development`
- [ ] Review (model baru): `/check review infrastruktur PostgreSQL development`
- [ ] Dokumentasikan: `/document infrastruktur PostgreSQL development`
