# 0001. Stack, audit, dan scaffold workspace

**Date**: 2026-10-12
**Status**: Accepted

## Summary

Spec ini menetapkan toolchain dan tata letak monorepo Foundation Rust setelah audit versi pada 2026-10-12: Angular 22.2.2 yang dibangun di atas Node.js 24 LTS, Rust 1.99.0 dengan Axum 0.8 dan Tokio 1.53 LTS, Cargo Workspace untuk Rust, dan Bun Workspace (Bun hanya sebagai package manager dan task runner) untuk Angular. Toolchain dan dependency JavaScript dipin tepat, dependency Rust dikunci `Cargo.lock`, dan kedua lockfile di-commit, sehingga clean checkout menghasilkan build yang sama di mesin mana pun. Spec ini menjadi payung (keputusan induk) untuk bagian 1; keputusan akses data, kontrak, generator client, auth, RBAC, styling, dan profil deployment tetap milik spec fitur pemiliknya.

## Requirements

**User stories**:

- Sebagai pengembang baru, Anda dapat clone repo, memasang dependency dari lockfile, lalu membangun kerangka API dan web tanpa menebak versi alat.
- Sebagai pemelihara, Anda dapat melihat versi mana yang dipakai, mengapa, dari sumber apa, dan kapan perlu ditinjau ulang.
- Sebagai agent yang mengerjakan fitur berikutnya, Anda tahu teknologi mana yang sudah diputuskan dan mana yang menunggu spec lain, sehingga tidak memilih alat baru secara diam diam.

**Acceptance criteria**:

1. **AC-1**: Matriks audit toolchain tersedia di [rationale.md](rationale.md) dengan kolom komponen, versi terpasang, versi usulan, status dukungan, kebutuhan kompatibilitas, sumber, status verifikasi, dan tindakan. Setiap angka versi berasal dari registry atau halaman resmi yang diperiksa pada 2026-10-12. Baris berstatus `sebagian` hanya boleh memuat angka versi yang sudah diperiksa di registry; bagian yang belum terbukti (misalnya kecocokan) disebut eksplisit, dan komponen itu tidak dipasang di fitur 1. Hal yang tidak dapat diperiksa sama sekali ditandai `belum diverifikasi` tanpa angka.
2. **AC-2**: Decision log di spec ini mencantumkan setiap keputusan wajib dari brief (`docs/foundation.md` bagian 4) dengan status `diusulkan`, `terverifikasi`, atau `menunggu keputusan`, kandidat default untuk setiap keputusan yang belum diambil, dan fitur pemiliknya. Draft ADR untuk keputusan utama spec ini tersedia di [rationale.md](rationale.md).
3. **AC-3**: Toolchain dipin di repo: `rust-toolchain.toml` memakai channel `1.99.0` dengan komponen `rustfmt` dan `clippy`; `.nvmrc` berisi `24.21.0`; `package.json` root memuat `"packageManager": "bun@1.4.3"`. Semua dependency langsung di setiap `package.json` ditulis dengan versi tepat (tanpa `^`, `~`, `*`, `x`, rentang, atau tag seperti `latest`). Test `scripts/pins.test.ts` menolak pelanggaran ini.
4. **AC-4**: Satu satunya lockfile package manager di repo adalah `bun.lock` di root, ditambah `Cargo.lock` di root. Tidak ada `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, atau `bun.lockb` di antara file yang dilacak atau tidak diabaikan git (folder `node_modules`, `target`, dan `dist` dikecualikan karena berisi paket pihak ketiga). `skills-lock.json` bukan lockfile package manager. Test `scripts/pins.test.ts` memeriksa ini. `npm install` di root gagal dengan kode `EBADDEVENGINES` yang menyebut `bun`.
5. **AC-5**: Tata letak workspace sesuai bagian *Berkas yang dibuat fitur 1*: `Cargo.toml` root adalah workspace virtual (tanpa `[package]`) dengan `resolver = "3"`, member `apps/api`, dan `[workspace.package]` berisi `version = "0.1.0"`, `edition = "2024"`, serta `rust-version = "1.99"`. `package.json` root mendeklarasikan workspace `apps/web`. `apps/web` tidak punya lockfile, `.gitignore`, atau field `packageManager` sendiri.
6. **AC-6**: Clean checkout reproducible. Salinan bersih dibuat dari `git ls-files -z --cached --others --exclude-standard` ke direktori sementara, lalu di sana dijalankan `git init`, `git add -A`, dan satu commit. Pada salinan itu `bun ci` berhasil, `cargo build --locked --workspace` berhasil, dan `bun run build:web` berhasil. Setelah ketiganya, `git status --porcelain` pada salinan kosong (lockfile dan file lain tidak berubah).
7. **AC-7**: Kerangka `apps/api` adalah binary Axum di atas Tokio tanpa route, tanpa konfigurasi, tanpa logging, dan tanpa database. _(Sejak spec 0002, alamat listen dan konfigurasi berasal dari skema konfigurasi; default tetap `127.0.0.1:3000`.)_ `cargo run --locked -p api` mencetak satu baris `api listening on http://127.0.0.1:3000` lalu listen di `127.0.0.1:3000` (alamat sementara, diganti skema konfigurasi fitur 3). Request `GET` dan `POST` ke path acak di `127.0.0.1:3000` menghasilkan 404. Bila port sudah dipakai, proses keluar dengan status bukan nol dan pesan yang menyebut alamat itu.
8. **AC-8**: Kerangka `apps/web` adalah aplikasi Angular 22.2.2 CSR (render di browser). Standalone dan strict berarti `"strict": true` di `apps/web/tsconfig.json` dan tidak ada `NgModule` di `src`. Zoneless berarti `zone.js` tidak ada di `package.json` mana pun, tidak terpasang di `node_modules`, tidak punya entri paket sendiri di `bun.lock` (namanya boleh muncul hanya sebagai optional peer milik `@angular/core`), tidak ada di `polyfills` pada `angular.json`, dan `provideZoneChangeDetection` tidak dipakai. Tanpa SSR berarti `angular.json` tidak punya opsi `server`, `ssr`, atau `prerender`, dan build tidak menghasilkan folder `apps/web/dist/web/server`. Build menghasilkan `apps/web/dist/web/browser/index.html`. `bun run test:web` menjalankan `app.spec.ts` bawaan dengan Vitest dan jsdom sampai lulus tanpa mode watch.
9. **AC-9**: Angular CLI, build, dan test berjalan di Node.js, bukan di runtime Bun. Setiap script di `apps/web/package.json` diawali `node ../../scripts/guard-node.mjs &&`. Guard lulus hanya bila `process.versions.bun` tidak terdefinisi, major Node sama dengan major di `.nvmrc`, dan versi Node tidak lebih rendah dari batas bawah `engines.node` di `package.json` root. Bila gagal, guard menulis satu baris ke stderr yang menyebut penyebabnya (runtime Bun, atau versi Node yang ditemukan dibanding yang diminta) lalu keluar dengan status 1. Dibuktikan dengan tiga skenario: `bun run build:web` lulus, `bun --bun run --filter web build` gagal, dan `bun run build:web` dengan PATH tanpa `node` gagal.

## Decision

**Chosen option**: Option 1, dua workspace native (Cargo Workspace dan Bun Workspace) dikoordinasikan oleh script Bun di root, dengan pin toolchain tepat dan dua lockfile.

Bangun monorepo dengan alat bawaan setiap ekosistem, tanpa framework orkestrasi monorepo, dan kunci setiap versi alat serta dependency di repo.

**Implementation skills**: `angular-developer` (`angular/skills`, `~/.agents/skills/angular-developer/`) · `angular-new-app` (`angular/skills`, `.claude/skills/angular-new-app/`) · `ng22-vitest` (`pavananguluri/angular22-agent-skills`, `.claude/skills/ng22-vitest/`)

## Proposed stack

Versi di tabel ini adalah hasil audit 2026-10-12 (rincian dan sumber di [rationale.md](rationale.md)). Baris tanpa catatan fitur lain dipasang oleh fitur 1; sisanya dipasang oleh fitur yang membutuhkannya (install just in time).

| Layer | Pilihan | Alasan |
| --- | --- | --- |
| Bahasa dan framework frontend | Angular `22.2.2` (CSR, standalone, zoneless), `@angular/build` `22.2.2`, TypeScript `6.0.3`, RxJS `7.8.2`, tslib `2.8.1` | Rilis stabil terbaru major 22 (active sampai 2027-06, LTS sampai 2028-06); Angular 22 hanya menerima TypeScript `>=6.0 <6.1`, jadi TypeScript 7 sengaja tidak dipakai. |
| Runtime untuk Angular CLI, build, dan test | Node.js `24.21.0` (LTS Krypton) | Satu satunya jalur Active LTS hari ini, didukung sampai 2028-04-30, dan sudah terpasang; Node 26 baru menjadi LTS pada 2026-10-28. |
| Package manager, workspace, task runner | Bun `1.4.3`, lockfile teks `bun.lock`, linker `hoisted` | Diwajibkan brief; layout `hoisted` meniru layout npm yang diasumsikan Angular CLI, karena kecocokan Angular dengan layout `isolated` belum terbukti. |
| Bahasa backend | Rust `1.99.0`, edition 2024, resolver 3 | Stable terbaru; Rust tidak punya LTS, jadi pin patch tepat dan naikkan secara sadar. |
| Framework dan async runtime backend | Axum `0.8.9`, Tokio `~1.53` (LTS sampai 2027-09) | Axum terbaru stabil; Tokio dijaga di jalur LTS dengan requirement tilde agar `cargo update` tidak naik ke 1.54 yang menaikkan MSRV. |
| Database dev (dipasang fitur 5) | PostgreSQL `18.6`, image `postgres:18.6-trixie` | Major stabil tertinggi (EOL 2030-11-14); 19 masih beta. Topologi dan role milik spec fitur 5. |
| Container dev (dipakai fitur 5) | Docker Engine minimal `29.8.2`, Compose minimal `v5.5.1`, file `compose.yaml` | Versi terpasang sudah mendukung healthcheck, `depends_on` dengan `service_healthy`, dan profiles. |
| Unit dan component test web | Vitest `5.0.3` lewat `@angular/build:unit-test`, jsdom `30.1.2` | Default Angular 22, berjalan di Node. Dipilih pengguna. |
| Test Rust | `cargo test` bawaan | Tanpa binary tambahan. Dipilih pengguna. |
| E2E browser (dipasang saat E2E pertama) | Playwright `@playwright/test` `1.64.0` | Multi browser dan cocok untuk skenario cookie lintas origin Profil A. Dipilih pengguna. |
| Test untuk script tooling | `bun test scripts` bawaan Bun | Script tooling dijalankan Bun sebagai task runner, jadi test memakai runner bawaan Bun tanpa dependency tambahan. Cakupan dibatasi ke `scripts` agar spec Vitest Angular tidak ikut dijalankan. |
| Tipe TypeScript untuk script tooling (dipasang fitur 2) | `@types/bun` `1.4.3` dan `@types/node` `24.19.2` | Hanya definisi tipe untuk Bun dan Node yang sudah dipilih, agar `scripts/` lulus typecheck strict; versinya mengikuti pin Bun dan major Node. Ditambahkan 2026-10-12 saat fitur 2 dan disetujui pengguna. |
| Format TypeScript, HTML, CSS, JSON, Markdown | Prettier `3.9.10` (terpasang bersama scaffold karena template Angular 22 menyertakannya; konfigurasi dan pemindahan ke root oleh fitur 2) | Kombinasi yang didukung resmi Angular. Dipilih pengguna. |
| Lint TypeScript dan template (dipasang fitur 2) | ESLint `10.12.0`, `typescript-eslint` `8.71.1`, `angular-eslint` `22.6.0` | Biome belum mendukung template Angular. Dipilih pengguna. |
| Lint dan format Rust (dipasang fitur 2) | `rustfmt` dan Clippy dari toolchain yang dipin | Ikut versi toolchain, tidak perlu pin terpisah. |
| Hook pre-commit (dipasang fitur 2) | Git native `core.hooksPath` ke folder hook di repo, diaktifkan script `prepare` root | Tanpa dependency; hook memanggil task Bun yang sama dengan CI. Dipilih pengguna. |
| CI (dipasang fitur 2) | GitHub Actions: `actions/checkout@v7`, `actions/setup-node@v7` dengan `node-version-file: .nvmrc`, `oven-sh/setup-bun@v2`, `actions-rust-lang/setup-rust-toolchain@v2`, `actions/cache@v6` untuk cache Bun | Dipilih pengguna. setup-node wajib ada agar Angular tidak jatuh ke runtime Bun. |

**Teknologi di luar tabel ini** tidak dipasang oleh fitur bagian 1. Library akses data, generator OpenAPI, library konfigurasi, auth, styling, dan observability dipilih di spec fitur pemiliknya (lihat decision log).

## Workspace design

**Tata letak.** Direktori dibuat hanya saat ada isinya; daftar ini adalah peta tujuan dari brief bagian 6.

| Path | Isi | Dibuat oleh |
| --- | --- | --- |
| `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` | Workspace Cargo virtual dan pin toolchain Rust | Fitur 1 |
| `package.json`, `bun.lock`, `bunfig.toml`, `.nvmrc`, `.gitignore` | Workspace Bun, pin Bun dan Node, konfigurasi install dan test, aturan ignore | Fitur 1 |
| `apps/api/` | Binary Axum, composition root backend | Fitur 1 (kerangka), fitur 8 (struktur) |
| `apps/web/` | Workspace Angular CLI (`angular.json` di sini), anggota Bun Workspace | Fitur 1 |
| `scripts/` | Guard runtime (JavaScript di Node), test tooling, dan script task root (TypeScript di Bun) | Fitur 1 (guard dan test pin), fitur 4 (task) |
| `crates/` | Crate modul dan adapter Rust | Fitur 6 dan 8 |
| `packages/api-client/` | Client Angular hasil generate | Fitur 12 |
| `contracts/` | Kontrak OpenAPI canonical | Fitur 11 |
| `migrations/` | Migration berversi | Fitur 6 |
| `infrastructure/` | Compose dan konfigurasi deployment | Fitur 5 |
| `.claude/skills/`, `skills-lock.json` | Agent Skill proyek yang dipasang saat `/architect` fitur 1 | Fitur 1 |
| `docs/` | Scope, spec, review, panduan | Semua fitur |

**Koordinasi dua workspace.** Cargo mengelola graph dependency Rust dan Bun mengelola graph JavaScript; keduanya tidak saling membaca. Root `package.json` menjadi satu pintu task: script Bun memanggil `cargo` untuk Rust dan menjalankan script workspace `apps/web` untuk Angular. Daftar task lengkap ditetapkan spec fitur 4; fitur 1 hanya menyediakan lima script di bawah.

**Pemisahan runtime.** Bun menjalankan install, `bun run`, dan test script tooling. Angular CLI, `@angular/build`, dan Vitest berjalan di Node: `bun run` menghormati shebang `#!/usr/bin/env node` milik bin `ng` dan memakai Node asli selama `node` ada di PATH (dibuktikan eksperimen audit). Bun diam diam memakai runtimenya sendiri bila `node` tidak ada di PATH atau saat flag `--bun` dipakai, karena itu guard menjaga setiap script web. Guard dan `ng` sama sama me-resolve `node` dari PATH yang sama di dalam `bun run`, jadi lulusnya guard berarti `ng` juga berjalan di Node. Proyek tidak boleh menyetel bagian `[run]` di `bunfig.toml`, dan script Angular selalu dipanggil lewat nama script atau bin, tidak pernah lewat path file (`bun ./file.js` selalu memakai runtime Bun).

### Berkas yang dibuat fitur 1

**`package.json` root** (nilai persis):

| Field | Nilai |
| --- | --- |
| `name` | `foundation-rust` |
| `private` | `true` |
| `packageManager` | `bun@1.4.3` |
| `workspaces` | `["apps/web"]` |
| `engines` | `{ "node": ">=24.15.0 <25" }` (batas bawah dari engines Angular untuk jalur 24, batas atas mengikat major `.nvmrc`) |
| `devEngines` | `{ "packageManager": { "name": "bun", "version": "1.4.3", "onFail": "error" } }` |
| `scripts.build:web` | `bun run --filter web build` |
| `scripts.test:web` | `bun run --filter web test` |
| `scripts.build:api` | `cargo build --locked -p api` |
| `scripts.run:api` | `cargo run --locked -p api` |
| `scripts.test:scripts` | `bun test scripts` |

Tidak ada dependency di root pada fitur 1.

**`bunfig.toml`**: bagian `[install]` dengan `linker = "hoisted"` dan `exact = true`; bagian `[test]` dengan `root = "scripts"`. Tidak ada bagian `[run]`, dan `trustedDependencies` tidak diisi.

**`.nvmrc`**: `24.21.0`.

**`rust-toolchain.toml`**: bagian `[toolchain]` dengan `channel = "1.99.0"`, `components = ["rustfmt", "clippy"]`, `profile = "minimal"`.

**`.gitignore` root**: `node_modules/`, `target/`, `apps/web/dist/`, `apps/web/.angular/`, `.DS_Store`.

**`Cargo.toml` root**: `[workspace]` dengan `resolver = "3"` dan `members = ["apps/api"]`; `[workspace.package]` dengan `version = "0.1.0"`, `edition = "2024"`, `rust-version = "1.99"`; `[workspace.dependencies]` dengan `axum = "0.8.9"` (fitur default) dan `tokio = "~1.53"`.

**`apps/api/Cargo.toml`**: `name = "api"`, `publish = false`, `version.workspace = true`, `edition.workspace = true`, `rust-version.workspace = true`; dependency `axum = { workspace = true }` dan `tokio = { workspace = true, features = ["rt-multi-thread", "macros", "net"] }`. Satu file `src/main.rs`, tanpa `lib.rs`.

**`apps/api/src/main.rs`**: fungsi `main` dengan `#[tokio::main]` membuat `tokio::net::TcpListener` di `127.0.0.1:3000`; kegagalan bind memanggil `expect` dengan pesan yang menyebut `127.0.0.1:3000` (proses keluar dengan status bukan nol). Setelah bind, satu `println!` mencetak `api listening on http://127.0.0.1:3000`, lalu `axum::serve(listener, Router::new())` berjalan sampai proses dihentikan. Tanpa tracing, konfigurasi, atau penanganan sinyal.

**Scaffold `apps/web`**: dijalankan dari root repo sebelum `package.json` root ditulis, karena `devEngines` juga memblokir `npx` dan `npm exec` di dalam repo. Perintahnya:

```
NG_CLI_ANALYTICS=false bunx @angular/cli@22.2.2 new web --directory apps/web --defaults --skip-install --skip-git --ssr=false --zoneless --standalone --strict --style=css --test-runner=vitest --ai-config=none --package-manager=bun --routing
```

Flag yang ditolak CLI 22.2.2 dihapus dari perintah, dan hasilnya tetap harus memenuhi AC-8. Setelah generate:

1. Hapus `apps/web/.gitignore` dan `apps/web/.vscode/` (task di dalamnya memanggil npm). Pertahankan `apps/web/.editorconfig` dan `apps/web/README.md`.
2. Hapus field `packageManager` dari `apps/web/package.json`; root menjadi satu satunya sumber.
3. Set `cli.analytics` ke `false` di `apps/web/angular.json`; pertahankan `cli.packageManager` bernilai `bun`.
4. Tulis ulang dependency `apps/web/package.json` dengan versi tepat berikut. Dependencies: `@angular/common`, `@angular/compiler`, `@angular/core`, `@angular/forms`, `@angular/platform-browser`, `@angular/router` semuanya `22.2.2`; `rxjs` `7.8.2`; `tslib` `2.8.1`. DevDependencies: `@angular/build`, `@angular/cli`, `@angular/compiler-cli` semuanya `22.2.2`; `jsdom` `30.1.2`; `prettier` `3.9.10`; `typescript` `6.0.3`; `vitest` `5.0.3`. Paket lain yang ternyata ditambahkan CLI dicatat sebagai baris baru di matriks audit dengan versi hasil resolve rentang bawaannya, lalu dipin tepat. File `apps/web/.prettierrc` hasil CLI dipertahankan sampai fitur 2.
5. Tulis ulang script `apps/web/package.json`: `ng`, `start`, `build`, `watch` mempertahankan perintah bawaan CLI dengan awalan `node ../../scripts/guard-node.mjs && `; `test` menjadi `node ../../scripts/guard-node.mjs && ng test --no-watch`. Nama package tetap `web`.

**`scripts/guard-node.mjs`**: JavaScript ES module tanpa dependency, berjalan di Node. Mengekspor fungsi murni `checkRuntime({ versions, nvmrc, enginesNode })` yang mengembalikan `{ ok: true }` atau `{ ok: false, reason }`. `nvmrc` boleh berawalan `v`; batas bawah diambil dari pembanding `>=` pada `enginesNode`. Saat dijalankan langsung, guard membaca `.nvmrc` dan `package.json` root lewat path yang dihitung dari `import.meta.url` (bukan direktori kerja), menulis `guard-node: <reason>` ke stderr, dan keluar dengan status 1 bila gagal. Pesan ditulis dalam bahasa Inggris, sama dengan keluaran alat lain. Tidak ada angka versi yang ditulis di dalam guard.

**`scripts/guard-node.test.ts`**: test `bun test` untuk `checkRuntime` (Node yang cocok, runtime Bun, major berbeda, versi di bawah batas, `.nvmrc` berawalan `v`) dan satu skenario yang menjalankan guard sebagai proses di bawah `bun --bun` dan mengharapkan status 1.

**`scripts/pins.test.ts`**: test `bun test` yang membaca setiap `package.json` di repo (di luar `node_modules`) dan menolak versi dependency yang bukan versi tepat, lalu memindai file dari `git ls-files --cached --others --exclude-standard` untuk lockfile package manager selain `bun.lock` dan `Cargo.lock`.

**Urutan scaffold.** (1) Tulis `rust-toolchain.toml` dan `.nvmrc`. (2) Jalankan scaffold `apps/web` di atas, lalu langkah 1 sampai 5 setelah generate. (3) Tulis `package.json` root, `bunfig.toml`, `.gitignore`, `scripts/`, dan berkas Cargo. (4) Jalankan `bun install` sekali untuk membuat `bun.lock`, lalu `cargo build --locked --workspace` setelah `cargo generate-lockfile` membuat `Cargo.lock`. (5) Jalankan pemeriksaan clean checkout AC-6, guard AC-9, dan `bun run test:scripts`.

**Strategi pin dan lockfile.**

| Objek | Cara pin | Ditegakkan oleh |
| --- | --- | --- |
| Rust | `rust-toolchain.toml` channel `1.99.0`, profile `minimal`, komponen `rustfmt` dan `clippy` | rustup (auto install) lokal dan `setup-rust-toolchain` di CI |
| Node | `.nvmrc` untuk versi tepat dan major; `engines.node` untuk batas bawah | nvm atau fnm lokal, `setup-node` dengan `node-version-file`, dan `scripts/guard-node.mjs` yang membaca keduanya |
| Bun | `packageManager` `bun@1.4.3`; `devEngines.packageManager` dengan `onFail: error` | `setup-bun` membaca `packageManager`; npm menolak install dan exec karena `devEngines` (Bun sendiri mengabaikan field ini) |
| Dependency JavaScript | Versi tepat di setiap `package.json`; `bunfig.toml` `exact = true` agar `bun add` menulis versi tepat | `bun ci` (setara `bun install --frozen-lockfile`) dan `scripts/pins.test.ts` |
| Dependency Rust | Requirement di `[workspace.dependencies]` root (caret default, Tokio `~1.53`); member mewarisi lewat `workspace = true` | `Cargo.lock` di-commit; `--locked` di semua script, gate, dan clean checkout |

**Prosedur upgrade.** Satu upgrade satu commit: periksa matriks kompatibilitas resmi (tabel versi Angular, peer dependency, MSRV crate), ubah pin atau versi, jalankan `bunx ng update` (berjalan di Node lewat shebang) untuk paket Angular atau `bun update <paket>` dan `cargo update -p <crate>`, kembalikan versi yang ditulis dengan `^` oleh `ng update` menjadi versi tepat, jalankan seluruh gate termasuk `scripts/pins.test.ts`, lalu commit manifest dan lockfile bersama. Upgrade yang mengubah versi di tabel Proposed stack memerlukan pembaruan spec ini lewat `/architect`.

**Key invariants**:

- Hanya `bun.lock` dan `Cargo.lock` yang menjadi lockfile package manager repo.
- Tidak ada dependency langsung JavaScript dengan rentang versi.
- Angular CLI tidak pernah berjalan di runtime Bun.
- Perintah `npx` dan `npm exec` tidak dipakai di repo; gunakan `bunx`.
- Kerangka tidak membaca secret, tidak membuka koneksi database, dan tidak memasang alat yang belum diputuskan.

**Security model**: Fitur ini tidak memproses data pengguna. Kerangka API hanya listen di loopback. Tidak ada secret, credential, atau file `.env` yang dibuat. Lifecycle script dependency tetap diblokir sesuai default Bun; `trustedDependencies` hanya diisi dengan alasan tertulis, karena mengisinya menggantikan daftar default Bun. Analytics Angular CLI dimatikan.

**Configuration required**: Tidak ada variabel environment baru. Alamat `127.0.0.1:3000` adalah konstanta sementara yang akan diganti skema konfigurasi fitur 3. `NG_CLI_ANALYTICS=false` hanya dipakai saat scaffold.

**Critical test scenarios**:

- Clean checkout: salinan bersih dari daftar file git, lalu `bun ci`, `cargo build --locked --workspace`, `bun run build:web`, dan `git status --porcelain` kosong, memverifikasi **AC-3**, **AC-5**, **AC-6**.
- Pin dan lockfile: `bun run test:scripts` menjalankan `scripts/pins.test.ts`; `npm install` di root gagal dengan `EBADDEVENGINES`, memverifikasi **AC-3**, **AC-4**.
- Kerangka API: pastikan port 3000 bebas, jalankan binary, kirim `GET` dan `POST` ke path acak di `127.0.0.1`, terima 404, hentikan proses; jalankan instance kedua saat yang pertama hidup dan pastikan gagal dengan pesan alamat, memverifikasi **AC-7**.
- Kerangka web: build menghasilkan `apps/web/dist/web/browser/index.html` tanpa folder `server`, `bun run test:web` lulus tanpa watch, pemeriksaan zoneless, strict, dan tanpa SSR di file konfigurasi, memverifikasi **AC-8**.
- Guard runtime: `bun run build:web` lulus, `bun --bun run --filter web build` gagal, PATH tanpa `node` gagal, dan test unit `checkRuntime`, memverifikasi **AC-9**.
- Dokumen: matriks audit dan decision log lengkap dengan status sah dan kandidat default, memverifikasi **AC-1**, **AC-2**.

## Decision log

Status mengikuti brief: `terverifikasi` berarti diputuskan dan versinya diperiksa pada sumber resmi, `diusulkan` berarti rekomendasi yang belum dikunci oleh spec pemilik, `menunggu keputusan` berarti dibawa oleh spec fitur lain. Kandidat default di baris `menunggu keputusan` adalah titik awal untuk `/architect` fitur pemilik, bukan keputusan.

| Keputusan | Pilihan saat ini atau kandidat default | Status | Pemilik |
| --- | --- | --- | --- |
| Tata letak monorepo dan koordinasi workspace | Cargo Workspace dan Bun Workspace, task root lewat Bun | terverifikasi | Spec ini |
| Package manager dan task runner | Bun `1.4.3`, linker `hoisted` | terverifikasi | Spec ini |
| Runtime Angular | Node.js `24.21.0` | terverifikasi | Spec ini |
| Versi Angular, TypeScript, RxJS | `22.2.2`, `6.0.3`, `7.8.2` | terverifikasi | Spec ini |
| Toolchain Rust, Axum, Tokio | `1.99.0`, `0.8.9`, `~1.53` | terverifikasi | Spec ini |
| Strategi pin, lockfile, dan upgrade | Pin tepat, dua lockfile, prosedur di atas | terverifikasi | Spec ini |
| Test runner | Vitest, `cargo test`, Playwright, `bun test` untuk script | terverifikasi | Spec ini |
| Provider CI | GitHub Actions | terverifikasi | Spec ini, dipasang fitur 2 |
| Lint, format, dan hook | ESLint, angular-eslint, Prettier, rustfmt, Clippy, `core.hooksPath` | terverifikasi | Spec ini, dipasang fitur 2 |
| Versi PostgreSQL dan image dev | `18.6`, `postgres:18.6-trixie` | terverifikasi | Fitur 5, [spec 0003](../0003-infrastruktur-postgresql-development/index.md) |
| Skema konfigurasi dan cara membacanya | Env proses saja, parser bertipe tanpa crate, `<NAMA>_FILE`, `config.json` runtime | terverifikasi | Fitur 3, [spec 0002](../0002-konfigurasi-tervalidasi-environment/index.md) |
| Antarmuka task root dan alat hot reload backend | Script Bun di root dan supervisor dengan watcher polling sendiri, tanpa alat tambahan | terverifikasi | Fitur 4, [spec 0004](../0004-task-root-lifecycle-development/index.md) |
| Akses data dan tooling migration | Kandidat: SQLx dengan query SQL tervalidasi dan migration SQL berversi | menunggu keputusan | Fitur 6 |
| Struktur modul dan batasnya | Kandidat: modular monolith, satu crate per modul dengan lapisan domain, application, infrastructure | menunggu keputusan | Fitur 8 |
| Sumber kebenaran OpenAPI | Kandidat: file OpenAPI yang ditulis lebih dulu di `contracts/` (design first) | menunggu keputusan | Fitur 11 |
| Generator client Angular | Kandidat: generator yang menghasilkan service Angular `HttpClient`, divalidasi terhadap Angular 22 | menunggu keputusan | Fitur 12 |
| Autentikasi dan sesi | Kandidat: session sisi server dengan cookie HttpOnly (asumsi index.md) | menunggu keputusan | Fitur 14 |
| Styling dan component library | Kandidat: CSS dengan design token sendiri; scaffold memakai CSS polos | menunggu keputusan | Fitur 15 |
| Model RBAC | Kandidat: role ke permission di database, default deny, dicek per use case | menunggu keputusan | Fitur 19 |
| Pemindaian dependency dan kebijakan umur rilis | Kandidat: `cargo-deny` dan audit dependency Bun di CI, otomasi update lewat GitHub | menunggu keputusan | Fitur 27 |
| Target deployment, OS, CPU, TLS, dan cross compile | Kandidat: image container Linux, TLS di reverse proxy | menunggu keputusan | Fitur 29 sampai 31 |
| Profil deployment default | Kandidat: Profil A dengan `/api` same origin (asumsi index.md) | menunggu keputusan | Fitur 29 |

## Consequences

**Positive**:

- Clean checkout menghasilkan pohon dependency yang sama di laptop dan CI karena semua pin hidup di repo.
- Tidak ada lapisan orkestrasi tambahan; setiap ekosistem memakai alat resminya, sehingga dokumentasi upstream langsung berlaku.
- Risiko Angular jatuh ke runtime Bun ditangkap guard, bukan ditemukan saat build production.
- Pelanggaran pin dan lockfile ganda tertangkap test otomatis, bukan pemeriksaan manual.

**Negative**:

- Developer butuh tiga alat terpasang (rustup, Node lewat nvm atau fnm, Bun) ditambah Docker untuk fitur 5.
- Pin tepat berarti upgrade selalu manual dan butuh disiplin; tidak ada perbaikan keamanan yang masuk otomatis sebelum otomasi update diputuskan di fitur 27. `ng update` menulis versi bertanda `^` yang harus dikembalikan ke versi tepat.
- `devEngines` membuat `npx` dan `npm exec` gagal di dalam repo; semua dokumentasi dan alat memakai `bunx`.
- Node 24 masuk Maintenance LTS pada 2026-10-20; perpindahan ke Node 26 perlu keputusan dalam beberapa bulan.
- Layout `hoisted` mengizinkan import dependency yang tidak dideklarasikan (phantom dependency); lint di fitur 2 perlu menutup celah ini bila penting.

**Neutral**:

- Banyak versi terpilih baru berumur kurang dari dua minggu. Tidak ada gerbang umur rilis sekarang; kebijakannya dibawa fitur 27.
- Alamat API sementara dan script root sementara akan berubah saat fitur 3 dan 4 selesai.

## Follow-up

- [ ] Tinjau ulang pin Node setelah Node 26 menjadi Active LTS (2026-10-28) dan sebelum Node 24 mendekati akhir dukungan.
- [ ] Layout `hoisted` masih mengizinkan import dependency yang tidak dideklarasikan (phantom dependency). Fitur 2 tidak menutupnya karena butuh alat lint baru di luar spec ini; putuskan lewat `/architect` (misalnya aturan import ESLint atau linker `isolated`) bila celah ini mulai berisiko.
- [ ] Mesin ini menjalankan PostgreSQL dari Laravel Herd di `127.0.0.1:5432` dan `127.0.0.1:5433`. Spec fitur 4 dan 5 perlu memilih port yang tidak bentrok dan mendeteksi konflik port.
- [ ] Kecocokan `tower-http` 0.7 dengan Axum 0.8.9 dibuktikan dengan build saat fitur pertama yang membutuhkannya (fitur 9, 10, atau 26).
- [ ] Scope fitur 1 menulis "tanpa angka yang belum diverifikasi"; spec ini memakai aturan AC-1 untuk baris `sebagian`. `/sync` atau `/scope` dapat menyelaraskan kalimat scope.
- [ ] Agent Skill untuk Rust dan Axum belum dipasang (pengguna memilih nanti). Kandidat yang ditemukan: `bobmatnyc/claude-mpm-skills@axum`, `wshobson/agents@rust-async-patterns`.
- [ ] MCP server resmi yang bisa Anda hubungkan sendiri lewat pengaturan MCP: Angular CLI (`npx @angular/cli mcp`, dijalankan di luar repo karena `devEngines`), Playwright MCP (`microsoft/playwright-mcp`), dan GitHub MCP (`github/github-mcp-server`).
- [ ] Konvensi skill `angular-developer`, `angular-new-app`, `ng22-vitest`, `docker-compose-patterns`, `playwright-cli`, `playwright-best-practices`, dan `gh-fix-ci` belum tercatat di `AGENTS.md`; `/audit` pada fitur 2 menambahkannya di bagian `## Agent skills`, termasuk aturan memakai `bunx`.

## Rationale

Konteks, opsi yang dibandingkan, alasan, matriks audit, dan draft ADR ada di [rationale.md](rationale.md).
