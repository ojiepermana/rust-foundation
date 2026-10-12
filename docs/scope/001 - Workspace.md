# Bagian 1: Fondasi workspace dan toolchain

Milestone M0 dan M1 pada brief: audit versi, keputusan arsitektur payung, scaffold kedua workspace, konvensi dan tooling, konfigurasi tervalidasi, task root, dan database development. Kembali ke [ringkasan scope](index.md).

## Fondasi (M0, M1)

### 1. Stack, audit, dan scaffold workspace · needs a decision

Audit versi dan dukungan (Angular 22 atau lebih baru yang stabil, Node.js, TypeScript, RxJS, Bun, Rust stable, Axum, Tokio, PostgreSQL, Docker) dengan sumber resmi dan tanggal pemeriksaan, lalu putuskan tata letak monorepo Cargo Workspace dan Bun Workspace, strategi pinning dan lockfile tunggal, test runner, dan provider CI. Spec ini menjadi payung; keputusan akses data, kontrak, generator, auth, RBAC, styling, dan profil deployment dibawa oleh fitur pemiliknya. Bila Angular 22 belum stabil atau tidak kompatibel, spec menyatakan blocker dan pilihan, bukan menurunkan requirement.

**Selesai ketika:** matriks audit (komponen, versi terpasang, versi usulan, status dukungan, kebutuhan kompatibilitas, sumber, status verifikasi, tindakan) tercatat tanpa angka yang belum diverifikasi; decision log dan ADR awal ada dengan status `diusulkan`, `terverifikasi`, atau `menunggu keputusan`; clean checkout memasang dependency dari lockfile yang tersimpan di repo dan membangun kerangka kosong `apps/api` serta `apps/web` secara reproducible; Bun berperan sebagai package manager dan task runner sementara Angular CLI, build, dan test berjalan pada Node.js versi yang didukung Angular.

- [ ] Audit toolchain dan putuskan stack (spec): `/architect stack, audit, dan scaffold workspace`
- [ ] Scaffold dari keputusan: `/develop stack, audit, dan scaffold workspace`
- [ ] Pastikan kerangka terbangun dari clean checkout: `/test`

### 2. Standar koding dan tooling

Tangkap konvensi nyata dari scaffold ke `AGENTS.md` root (gaya Rust dan TypeScript, aturan batas modul, perlakuan file hasil generate), lalu pasang format, Clippy, TypeScript strict, lint, hook `pre-commit`, dan CI dasar untuk fast PR checks.

**Selesai ketika:** `AGENTS.md` root mencerminkan stack nyata; format, Clippy, typecheck, dan lint berjalan bersih pada clean checkout dan pada CI dasar; file hasil generate dikecualikan dari lint dan ditolak bila diedit manual.

- [ ] Tangkap konvensi dan pilihan tooling: `/audit`
- [ ] Pasang tooling: `/develop tooling`
- [ ] Pastikan berjalan bersih: `/test`

### 3. Konfigurasi tervalidasi dan environment · needs a decision

Skema konfigurasi backend (nama variabel, tujuan, wajib atau opsional, default aman, secret atau bukan, aturan validasi, kebutuhan restart), precedence, pemisahan dev, test, staging, dan production, fail fast, `.env.example` tanpa secret, dan pemeriksaan misconfiguration production. Frontend memisahkan konfigurasi saat build dari runtime; semua yang dikirim ke browser bersifat publik, termasuk API base URL untuk kedua profil deployment.

**Selesai ketika:** aplikasi menolak start dengan pesan jelas saat variabel wajib hilang atau tidak valid; mode production menolak nilai tidak aman (misalnya cookie tanpa Secure, CORS wildcard, atau dev seed aktif); `.env.example` lengkap tanpa nilai secret; nilai secret tidak pernah muncul di log; API base URL frontend dapat diatur per profil tanpa secret di bundle Angular.

- [ ] Rancang skema konfigurasi (spec): `/architect konfigurasi tervalidasi dan environment`

### 4. Task root dan lifecycle development · needs a decision

Satu antarmuka task di root yang mengoordinasikan Cargo Workspace dan Bun Workspace: install, dev, build, lint, test, E2E, generate dan check kontrak, migrate dan status, seed dev, lifecycle Compose, serta build dan smoke kedua profil. Lifecycle dev menjalankan frontend dan backend bersama proxy, hot reload, log terpisah, shutdown child process, deteksi konflik port, dan dukungan lintas OS tanpa layanan production.

**Selesai ketika:** daftar task root terdokumentasi dan setiap task berjalan dari clean checkout; satu perintah dev menjalankan frontend, backend, dan proxy lalu menghentikan semuanya bersih saat Ctrl+C; konflik port dilaporkan jelas; hanya ada satu lockfile package manager di repo.

- [ ] Rancang antarmuka task dan lifecycle (spec): `/architect task root dan lifecycle development`

### 5. Infrastruktur PostgreSQL development · needs a decision

Compose untuk development dengan PostgreSQL dan service minimum, volume persisten, prosedur reset yang ditandai destruktif, serta identitas database terpisah untuk migrator dan runtime dengan privilege minimum. Database test terisolasi dari data dev.

**Selesai ketika:** satu perintah menyediakan PostgreSQL siap koneksi dengan credential dari environment lokal, bukan dari repo; reset destruktif memerlukan konfirmasi eksplisit; role migrator dan runtime berbeda privilege dan dibuktikan oleh test; test integrasi memakai database terisolasi tanpa menyentuh data dev.

- [ ] Rancang topologi dev dan role database (spec): `/architect infrastruktur PostgreSQL development`
