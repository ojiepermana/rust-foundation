# 0001. Rationale: stack, audit, dan scaffold workspace

Catatan keputusan untuk [spec 0001](index.md). Bagian ini tidak dibaca `/develop` saat membangun; isinya alasan, pembanding, dan bukti audit.

## Context

Repo `foundation/rust` masih kosong selain `docs/` saat audit (2026-10-12, macOS arm64, Darwin 27.0.0). Brief di `docs/foundation.md` mewajibkan Angular 22 atau lebih baru yang stabil, Rust stable dengan Axum dan Tokio, Cargo Workspace untuk Rust, Bun Workspace untuk Angular dan paket TypeScript, PostgreSQL dengan migration berversi, serta dua profil deployment. Brief juga melarang menjadikan framework orkestrasi monorepo, microservices, atau Kubernetes sebagai kebutuhan awal tanpa alasan terukur.

Dua ekosistem dengan manajer dependency berbeda harus hidup di satu repo tanpa saling mengganggu. Bun diminta berperan sebagai package manager dan task runner, tetapi Angular CLI, build, dan test harus berjalan pada runtime yang didukung dokumentasi Angular, yaitu Node.js. Bun dapat menjalankan bin JavaScript dengan runtimenya sendiri, sehingga pembagian peran ini harus dibuat eksplisit dan dapat dibuktikan.

Starterkit dipakai tim kecil sampai menengah, sering di mesin baru. Kegagalan paling mahal di fase ini adalah build yang berbeda antara laptop dan CI, atau versi yang dipilih dari ingatan lalu ternyata tidak kompatibel. Semua angka versi harus berasal dari sumber resmi dengan tanggal pemeriksaan, dan setiap keputusan wajib dari brief perlu status yang jelas agar fitur berikutnya tahu apa yang sudah dikunci.

Konsekuensi bila tidak diputuskan: setiap fitur berikutnya akan memilih versi dan alat sendiri, lockfile ganda muncul, dan bukti clean checkout tidak pernah bisa dibuat.

## Options considered

### Option 1: Dua workspace native, dikoordinasikan script Bun di root

Cargo Workspace di root untuk crate Rust, Bun Workspace di root untuk `apps/web` dan paket TypeScript berikutnya. Task root adalah script di `package.json` root yang memanggil `cargo` dan script workspace web. Toolchain dipin lewat file standar setiap ekosistem.

**Pros**:

- Tidak ada alat orkestrasi tambahan; setiap ekosistem memakai alat resminya.
- Satu pintu task (`bun run <task>`) untuk developer dan CI, sesuai brief.
- Mudah dipahami tim yang sudah mengenal Cargo dan npm style workspace.

**Cons**:

- Tidak ada cache task lintas workspace atau deteksi proyek terdampak; build penuh selalu berjalan.
- Script koordinasi ditulis dan dirawat sendiri.

### Option 2: Framework orkestrasi monorepo (Nx atau Turborepo) di atas Bun Workspace

Bun Workspace tetap menjadi package manager, tetapi task graph, cache, dan affected detection dikelola Nx atau Turborepo, dengan Cargo dipanggil sebagai target.

**Pros**:

- Cache task dan eksekusi hanya untuk proyek terdampak mempercepat CI di repo besar.
- Visualisasi graph dependency antarproyek.

**Cons**:

- Brief secara eksplisit menolak framework orkestrasi monorepo tanpa alasan terukur; repo ini baru punya dua aplikasi.
- Integrasi Cargo tidak native, sehingga cache Rust tetap diurus Cargo sendiri.
- Menambah satu alat besar dengan versi, plugin, dan model mental sendiri.

### Option 3: Task root di sisi Rust (`cargo xtask` atau `just`)

Task root ditulis sebagai crate `xtask` atau `justfile`, memanggil Bun untuk sisi web. Bun hanya menjadi package manager.

**Pros**:

- Developer Rust tetap di alat yang dikenal; `xtask` hanya butuh Cargo.
- Task bisa memakai crate Rust untuk logika yang rumit.

**Cons**:

- Bertentangan dengan brief yang meminta Bun sebagai task runner.
- `just` menambah binary global; `xtask` memperlambat task pertama karena harus dikompilasi.
- Developer frontend harus memahami Rust untuk mengubah task.

### Option 4: npm atau pnpm workspace di root, Bun hanya untuk script

Package manager JavaScript diganti npm atau pnpm yang lebih matang, Bun dipakai sebagai runtime script saja.

**Pros**:

- npm dan pnpm menegakkan `engines` dan punya ekosistem tooling CI yang lebih luas.
- Layout `node_modules` paling sesuai asumsi Angular CLI.

**Cons**:

- Bertentangan dengan brief yang mewajibkan Bun Workspace.
- Dua alat JavaScript (manager dan runtime) dengan aturan berbeda.

## Rationale

Option 1 dipilih karena memenuhi brief apa adanya (Cargo Workspace, Bun Workspace, Bun sebagai task runner) dengan permukaan alat paling kecil. Repo dengan dua aplikasi tidak punya masalah waktu build yang membenarkan cache task Nx atau Turborepo; brief bahkan meminta alasan terukur sebelum alat itu dipakai. Bila kelak waktu CI menjadi hambatan nyata, Option 2 bisa ditambahkan di atas struktur yang sama tanpa memindahkan direktori.

Pemisahan runtime menjadi alasan desain terpenting. Eksperimen audit membuktikan `bun run` menjalankan bin ber shebang Node dengan Node asli selama `node` ada di PATH, tetapi diam diam memakai runtime Bun bila `node` tidak ada atau flag `--bun` dipakai. Karena kegagalan ini tidak terlihat (exit 0, tanpa peringatan), spec memilih guard eksplisit sebelum setiap script Angular dan mewajibkan `setup-node` di CI, alih alih mempercayai PATH.

Linker `hoisted` dipilih walaupun `isolated` adalah default Bun untuk workspace baru, karena Angular CLI dan builder me-resolve paket dengan asumsi layout npm, dan kecocokan dengan layout `isolated` belum terbukti di audit. Runner up adalah `isolated`, yang lebih ketat terhadap phantom dependency; pilihan ini layak dicoba ulang setelah ada test clean checkout yang bisa membuktikannya.

Pin tepat untuk semua alat dan dependency langsung dipilih karena brief meminta instalasi reproducible dan karena banyak versi terbaru berumur kurang dari dua minggu: rentang versi akan membuat clean checkout bulan depan berbeda dari hari ini. Tokio memakai requirement tilde `~1.53` karena jalur LTS lebih berharga daripada fitur 1.54, dan requirement default Cargo akan naik ke 1.54 (MSRV 1.85) saat `cargo update`. Rust 1.99.0 dipilih (dengan izin pengguna untuk mengunduhnya) karena 1.97.0 yang terpasang sudah digantikan rilis perbaikan miskompilasi LLVM, dan 1.99 memperbaiki perilaku `default-features` dependency workspace pada edition 2024.

TypeScript dipin `6.0.3` walaupun `latest` di npm adalah `7.0.2`, karena Angular 22 dan typescript-eslint hanya menerima `<6.1`. Node 24 dipilih walaupun Node 26 akan menjadi LTS dalam enam belas hari, karena panduan resmi Node hanya menyarankan rilis LTS untuk produksi dan Node 24 tetap didukung sampai April 2028.

## Audit toolchain

Diperiksa pada 2026-10-12 oleh lima pemeriksa paralel (Angular, Node dan Bun, Rust, PostgreSQL dan Docker, tooling), lalu setiap kelompok diperiksa ulang oleh pemeriksa independen yang mengulang kueri registry. Koreksi pemeriksa sudah diterapkan di tabel ini. Kolom sumber menyebut halaman resmi atau perintah registry yang dijalankan.

Pada baris berstatus `sebagian` (tower-http, watchexec-cli, Biome), angka versi sudah diperiksa di registry; yang belum terbukti hanya klaim kecocokan atau MSRV, dan tidak satu pun dari komponen itu dipasang di fitur 1. Baris `belum diverifikasi` tidak memuat angka.

### Matriks

| Komponen | Versi terpasang | Versi usulan | Status dukungan | Kebutuhan kompatibilitas | Sumber | Status verifikasi | Tindakan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Angular framework (`@angular/core`, `common`, `compiler`, `compiler-cli`, `router`, `platform-browser`, `forms`) | tidak terpasang | `22.2.2` | Major 22 active sampai 2027-06, LTS sampai 2028-06; 22.2.2 terbit 2026-10-08; belum ada major 23 di registry | Node `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`; TypeScript `>=6.0 <6.1`; RxJS `^6.5.3 \|\| ^7.4.0`; `zone.js` opsional | `npm view @angular/core dist-tags`, `npm view @angular/compiler-cli@22.2.2 peerDependencies`, angular.dev/reference/releases, angular.dev/reference/versions | terverifikasi | Pin tepat `22.2.2` untuk semua paket framework |
| `@angular/cli` | tidak terpasang | `22.2.2` | Active, mengikuti major 22 | engines Node sama dengan framework; `ng new` mendukung `--package-manager bun` | `npm view @angular/cli@22.2.2 engines`, schema `@schematics/angular@22.2.2`, angular.dev/cli/new | terverifikasi | Scaffold `apps/web` lewat CLI di Node |
| `@angular/build` | tidak terpasang | `22.2.2` | Active; `@angular-devkit/build-angular` (Webpack) deprecated | Peer TypeScript `>=6.0 <6.1`, vitest `^4.0.8 \|\| ^5.0.0` (opsional); memakai Vite 8.3.0 dan esbuild 0.28.2 | `npm view @angular/build@22.2.2 peerDependencies dependencies` | terverifikasi | Builder application dan unit-test |
| TypeScript | tidak terpasang | `6.0.3` | Patch terakhir 6.0 (2026-04-16); `latest` npm 7.0.2 di luar rentang Angular | Angular 22 dan typescript-eslint menolak `>=6.1` | `npm view typescript dist-tags versions`, angular.dev/reference/versions | terverifikasi | Pin tepat `6.0.3`; jangan pakai `typescript@latest` |
| RxJS | tidak terpasang | `7.8.2` | `latest`; 8.x hanya alpha, 9.0.0 masih beta | Angular `^6.5.3 \|\| ^7.4.0` | `npm view rxjs dist-tags` | terverifikasi | Pin tepat `7.8.2` |
| tslib | tidak terpasang | `2.8.1` | `latest` stabil | Template `ng new` 22.2.2 menulis `^2.3.0` | `npm view tslib version`, `@schematics/angular@22.2.2` `utility/latest-versions/package.json` | terverifikasi | Pin tepat `2.8.1` di `apps/web` |
| `zone.js` | tidak terpasang | tidak dipasang | 0.16.3 latest; zoneless default sejak Angular 21 | Peer opsional Angular | schema application `@schematics/angular@22.2.2`, angular.dev/guide/zoneless | terverifikasi | Biarkan aplikasi zoneless |
| Node.js | `24.21.0` (nvm lewat Laravel Herd), npm 11.19.0 | `24.21.0` | LTS Krypton; Maintenance mulai 2026-10-20; EOL 2028-04-30. Node 26 Current, menjadi LTS 2026-10-28. Node 22 EOL 2027-04-30 | Memenuhi Angular `^24.15.0`, Vitest 5, jsdom 30, ESLint 10, Playwright | nodejs.org/dist/index.json, nodejs.org/en/about/previous-releases, `nodejs/Release` schedule.json | terverifikasi | Pin di `.nvmrc`; tinjau ulang setelah Node 26 LTS |
| Bun | `1.4.3` | `1.4.3` | Stabil terbaru (2026-10-10); tidak ada kebijakan LTS | Workspace, `workspace:*`, `--filter`; `bun.lock` teks; linker default `isolated` untuk workspace; mengabaikan `engines`, `packageManager`, `devEngines` | api.github.com/repos/oven-sh/bun/releases/latest, bun.com/docs/pm/workspaces, eksperimen lokal | terverifikasi | `packageManager` `bun@1.4.3`, `bun ci` di CI, linker `hoisted` |
| Perilaku `bun run` terhadap shebang Node | tidak berlaku | tidak berlaku | Shebang `#!/usr/bin/env node` dijalankan dengan Node asli bila `node` ada di PATH; `--bun` atau tanpa `node` memakai runtime Bun; `bun ./file.js` selalu runtime Bun | `process.release.name` tetap `node` di bawah Bun; deteksi lewat `process.versions.bun` | Dokumentasi `bun run`, eksperimen di direktori sementara | terverifikasi | Guard `scripts/guard-node.mjs` sebelum script Angular |
| Pin versi Node (`.nvmrc`, `.node-version`, `engines`, `devEngines`) | tidak ada | `.nvmrc` `24.21.0` | nvm hanya membaca `.nvmrc`; fnm membaca keduanya | `setup-node` tidak membaca file otomatis, wajib `node-version-file`; npm menegakkan `devEngines` | README nvm dan fnm, dokumentasi `actions/setup-node`, dokumentasi npm package.json | terverifikasi | `.nvmrc` dan `devEngines.packageManager` |
| Rust (rustc, cargo) | `1.97.0` (default) dan `1.96.0` | `1.99.0` | Stable terbaru (2026-10-01); 1.97.0 digantikan 1.97.1 (perbaikan miskompilasi LLVM); hindari 1.98.0 (bug vtable) | MSRV crate inti tertinggi 1.80 (axum); edition 2024 butuh `>=1.85`; resolver 3 butuh `>=1.84` | `rustup check`, blog.rust-lang.org, releases.rs | terverifikasi | Pin `1.99.0` di `rust-toolchain.toml` (unduhan diizinkan pengguna) |
| rustup | `1.29.0` | tidak dipin | 1.29.1 tersedia | Auto install toolchain aktif sejak 1.28.1 | `rustup check`, CHANGELOG rustup | terverifikasi | Alat global, tidak diubah |
| Rust edition dan resolver | tidak berlaku | edition `2024`, resolver `3` | Edition terbaru; resolver 3 default edition 2024 | Workspace virtual wajib menulis `resolver = "3"`; `rust-version` workspace memengaruhi pemilihan versi dependency | doc.rust-lang.org/edition-guide, doc.rust-lang.org/cargo/reference/resolver.html | terverifikasi | Tulis di `[workspace]` dan `[workspace.package]`, `rust-version = "1.99"` |
| `Cargo.lock` | tidak ada | di-commit | Panduan Cargo FAQ untuk aplikasi | Satu lockfile untuk seluruh workspace | doc.rust-lang.org/cargo/faq.html | terverifikasi | Commit dan pakai `--locked` |
| axum | tidak terpasang | `0.8.9` | Stabil terbaru (2026-04-14), belum ada 0.9 | `rust_version` 1.80; butuh tokio `^1.44`, tower `^0.5.2` | crates.io API `axum` dan dependensinya | terverifikasi | Dependency kerangka API |
| tokio | tidak terpasang | `~1.53` (resolve 1.53.2) | 1.53.x LTS sampai 2027-09, 1.51.x sampai 2027-03 | `rust_version` 1.71; 1.54 akan menaikkan MSRV ke 1.85 | crates.io API `tokio`, README tokio bagian LTS | terverifikasi | Requirement tilde `~1.53` |
| tower | tidak terpasang | `0.5.3` (transitif) | Stabil | Dibutuhkan axum `^0.5.2` | crates.io API `tower` | terverifikasi | Tidak dideklarasikan langsung di fitur 1 |
| tower-http | tidak terpasang | `0.7.1` (fitur berikutnya) | 0.7.0 punya breaking change (fitur `tokio` dihapus) | Trait setara dengan axum 0.8.9, belum dibuktikan dengan build | crates.io API `tower-http`, CHANGELOG tower-http | sebagian | Buktikan dengan build saat fitur yang membutuhkannya |
| serde, serde_json, tracing, tracing-subscriber, thiserror, anyhow | tidak terpasang | `1.0.229`, `1.0.154`, `0.1.44`, `0.3.23`, `2.0.21`, `1.0.104` | Stabil terbaru | MSRV tertinggi 1.77 (thiserror) | crates.io API per crate | terverifikasi | Tidak dipasang di fitur 1; dipakai fitur yang membutuhkan |
| cargo-nextest | tidak terpasang | tidak dipakai | 0.9.148 terbaru | MSRV build 1.91; pemasangan menulis ke `~/.cargo/bin` | crates.io API, nexte.st | terverifikasi | Tidak dipasang (pengguna memilih `cargo test`) |
| cargo-deny | `0.20.2` | `0.20.2` | Terbaru | `rust_version` 1.88 | `cargo-deny --version`, crates.io API | terverifikasi | Kandidat fitur 27 |
| cargo-watch | tidak terpasang | jangan dipakai | Repo diarsipkan, tidak dipelihara | Tidak berlaku | crates.io API, README cargo-watch | terverifikasi | Fitur 4 memilih antara bacon dan watchexec-cli |
| bacon, watchexec-cli | tidak terpasang | `3.26.0`, `2.8.0` | Aktif dipelihara | bacon MSRV 1.85; MSRV watchexec-cli tidak dideklarasikan | crates.io API, rilis GitHub | terverifikasi (bacon), sebagian (watchexec-cli) | Keputusan fitur 4 |
| PostgreSQL server | tidak terpasang sebagai alat proyek; Laravel Herd menjalankan PostgreSQL 18.0 di port 5432 dan 5433 | `18.6` | 18 EOL 2030-11-14; 18.5 tidak pernah dirilis; 19 masih Beta 4; 14 EOL 2026-11-12 | Klien psql 18 cocok | postgresql.org/support/versioning, catatan rilis 18.6, pemeriksaan proses lokal | terverifikasi | Fitur 5 memakai container, bukan Herd |
| Image Docker `postgres` | tidak ada | `postgres:18.6-trixie` | Tag 18.6, 18, latest menunjuk build yang sama | PG 18: volume di `/var/lib/postgresql`, PGDATA `/var/lib/postgresql/18/docker`; skrip init hanya jalan pada volume kosong | Docker Hub tags API, docker-library/postgres entrypoint dan docs | terverifikasi | Keputusan rinci fitur 5 |
| Docker Engine | `29.8.2` (Docker Desktop 4.94.0) | minimal `29.8.2` | 29.9.0 rilis 2026-10-08, belum dibundel Desktop | Tidak berlaku | docs.docker.com/engine/release-notes, `docker version` | terverifikasi | Dokumentasikan versi minimum |
| Docker Compose | `v5.5.1` | minimal `v5.5.1` | v5.6.0 terbaru (2026-10-02) | `compose.yaml` tanpa field `version`; healthcheck, `service_healthy`, profiles tersedia sejak 2.x | rilis GitHub docker/compose, docs.docker.com/reference/compose-file | terverifikasi | Dipakai fitur 5 |
| Vitest dan jsdom | tidak terpasang | `5.0.3`, `30.1.2` | Stabil terbaru | Peer `@angular/build` vitest `^4.0.8 \|\| ^5.0.0`; builder memilih happy-dom bila terpasang, jadi pasang jsdom saja | `npm view vitest@5.0.3 engines`, `npm view jsdom@30.1.2 engines`, angular.dev/guide/testing | terverifikasi | Dipasang bersama scaffold web |
| Karma dan Jasmine | tidak terpasang | tidak dipakai | Karma deprecated upstream, masih didukung Angular sebagai opsi | Tidak berlaku | README karma, angular.dev/guide/testing | terverifikasi | Tidak dipasang |
| `@playwright/test` | tidak terpasang | `1.64.0` | Stabil terbaru (2026-10-07) | Node 22, 24, 26; browser diunduh terpisah | `npm view @playwright/test@1.64.0 engines`, playwright.dev/docs/intro | terverifikasi | Dipasang saat E2E pertama |
| ESLint, `@eslint/js`, typescript-eslint, angular-eslint | tidak terpasang | `10.12.0`, `10.0.1`, `8.71.1`, `22.6.0` | Stabil terbaru | typescript-eslint menolak TypeScript `>=6.1`; angular-eslint butuh `@angular-devkit >=22 <23` | `npm view` per paket, typescript-eslint.io/users/dependency-versions | terverifikasi | Dipasang fitur 2 |
| Prettier, eslint-config-prettier | tidak terpasang | `3.9.10`, `10.1.8` | Stabil terbaru; Prettier 4 masih alpha | `ng new` Angular 22 menambahkan Prettier secara default | `npm view prettier dist-tags`, template workspace `@schematics/angular` | terverifikasi | Dipasang bersama scaffold, dikonfigurasi fitur 2 |
| Biome | tidak terpasang | tidak dipakai | 2.5.15 | Tidak mendokumentasikan template Angular | biomejs.dev/internals/language-support | sebagian | Pembanding saja |
| Hook git (`core.hooksPath`, lefthook, husky, simple-git-hooks) | git `2.54.0` | `core.hooksPath` native | Fitur inti git sejak 2.9 | Hook butuh bit executable; aktivasi per clone lewat script `prepare` | git-scm.com/docs/githooks, `npm view` lefthook husky simple-git-hooks | terverifikasi | Dipasang fitur 2 |
| Target deployment, OS dan CPU, TLS, compiler dan linker, cross compile | macOS arm64 untuk development; target production belum ditentukan | tidak berlaku | belum diverifikasi | Bergantung pada profil deployment dan image runtime | Belum diperiksa; ditunda | belum diverifikasi | Diaudit oleh fitur 29 sampai 31 |
| GitHub Actions | tidak berlaku | `checkout@v7`, `setup-node@v7`, `setup-bun@v2`, `setup-rust-toolchain@v2`, `cache@v6` | Rilis terbaru per action | `setup-node` butuh `node-version-file`; `setup-bun` membaca `packageManager`; `setup-rust-toolchain` membaca `rust-toolchain.toml` dan menolak warning secara default | API rilis GitHub dan `action.yml` setiap action | terverifikasi | Dipasang fitur 2 |

### Temuan yang memengaruhi desain

- Bun mengabaikan `engines`, `packageManager`, dan `devEngines` sepenuhnya, termasuk rentang yang mustahil. Penegakan versi harus dilakukan guard, CI, atau npm.
- Mengisi `trustedDependencies` menggantikan daftar default Bun, bukan menambahnya. Paket penting di daftar default (misalnya `esbuild`) harus ditulis ulang bila daftar itu diisi.
- `bun ci` setara dengan `bun install --frozen-lockfile`; Bun tidak mengaktifkan mode beku otomatis di CI.
- Ditemukan saat build fitur 1: `bun run` tingkat atas membuat shim `node` milik Bun bila `node` tidak ada di PATH (guard lalu melaporkan runtime Bun), tetapi `bun run` yang bersarang di dalam `bun run` lain tidak membuat shim, sehingga shell gagal lebih dulu dengan `node: command not found`. Keduanya berhenti sebelum Angular berjalan.
- `actions-rust-lang/setup-rust-toolchain@v2` membuat warning Cargo menggagalkan CI secara default.
- Image `postgres` 18 memindahkan volume ke `/var/lib/postgresql`; contoh lama yang me-mount `/var/lib/postgresql/data` salah. Healthcheck sebaiknya lewat TCP karena server sementara saat init hanya listen di socket.

## Draft ADR

Setiap ADR mengikuti format brief: rekomendasi, alasan, satu alternatif, tradeoff, dampak, kapan ditinjau ulang, dan status.

### ADR-0001: Dua workspace native dengan Bun sebagai task runner

- **Rekomendasi**: Cargo Workspace dan Bun Workspace di root; task root berupa script Bun.
- **Alasan**: memenuhi brief dengan alat paling sedikit; tidak ada masalah build yang membenarkan orkestrator.
- **Alternatif**: Nx atau Turborepo di atas Bun Workspace.
- **Tradeoff**: tanpa cache task dan affected detection.
- **Dampak**: semua fitur memanggil task lewat `bun run`; Cargo tetap dipakai langsung untuk Rust.
- **Tinjau ulang bila**: waktu CI penuh melebihi target yang ditetapkan fitur 28 secara konsisten.
- **Status**: terverifikasi.

### ADR-0002: Angular dijalankan di Node, bukan runtime Bun

- **Rekomendasi**: Node.js `24.21.0` untuk Angular CLI, build, dan test, dengan guard runtime sebelum setiap script web.
- **Alasan**: dokumentasi Angular hanya mendukung Node; Bun diam diam mengganti runtime bila `node` tidak ada.
- **Alternatif**: menjalankan `ng` lewat path eksplisit `node node_modules/@angular/cli/bin/ng.js` tanpa guard.
- **Tradeoff**: guard menambah satu proses kecil sebelum setiap script web.
- **Dampak**: CI wajib memasang Node; developer wajib punya Node sesuai `.nvmrc`.
- **Tinjau ulang bila**: Angular resmi mendukung Bun sebagai runtime, atau Node 26 menjadi LTS.
- **Status**: terverifikasi.

### ADR-0003: Pin tepat dan dua lockfile

- **Rekomendasi**: toolchain dipin di `rust-toolchain.toml`, `.nvmrc`, `packageManager`; dependency JavaScript dengan versi tepat; dependency Rust dikunci `Cargo.lock`; Tokio di jalur LTS.
- **Alasan**: brief meminta instalasi reproducible; banyak versi terbaru masih sangat baru.
- **Alternatif**: rentang caret di manifest dengan lockfile sebagai satu satunya kunci.
- **Tradeoff**: upgrade manual dan lebih sering; tidak ada patch keamanan otomatis.
- **Dampak**: setiap upgrade melewati prosedur di spec dan seluruh gate.
- **Tinjau ulang bila**: fitur 27 memutuskan otomasi update dependency dan kebijakan umur rilis.
- **Status**: terverifikasi.

### ADR-0004: Test runner per lapisan

- **Rekomendasi**: Vitest lewat Angular CLI untuk web, `cargo test` untuk Rust, Playwright untuk E2E, `bun test` untuk script tooling.
- **Alasan**: masing masing adalah default resmi ekosistemnya sehingga tanpa alat tambahan; dipilih pengguna.
- **Alternatif**: cargo-nextest untuk Rust (isolasi proses per test, lebih cepat di CI).
- **Tradeoff**: `cargo test` menjalankan test integration dalam satu proses per binary, jadi isolasi database harus diatur di test.
- **Dampak**: fitur 6 dan seterusnya merancang isolasi database test sendiri.
- **Tinjau ulang bila**: test Rust menjadi lambat atau flaky karena berbagi proses.
- **Status**: terverifikasi.

### ADR-0005: GitHub Actions sebagai CI

- **Rekomendasi**: GitHub Actions dengan action resmi setup Node, Bun, dan Rust.
- **Alasan**: akun GitHub sudah tersedia dan repo saudara memakainya; logika task tetap di script Bun sehingga portable.
- **Alternatif**: GitLab CI.
- **Tradeoff**: cache dependency Bun harus diatur manual lewat `actions/cache`.
- **Dampak**: fitur 2 memasang workflow fast PR checks; fitur 32 memperluasnya.
- **Tinjau ulang bila**: repo pindah ke host lain.
- **Status**: terverifikasi.

### ADR-0006: Lint, format, dan hook

- **Rekomendasi**: ESLint dengan angular-eslint dan typescript-eslint, Prettier, rustfmt, Clippy, hook git native lewat `core.hooksPath`.
- **Alasan**: dukungan resmi untuk template Angular; hook tanpa dependency memanggil task yang sama dengan CI.
- **Alternatif**: Biome untuk lint dan format TypeScript; lefthook untuk hook.
- **Tradeoff**: dua alat JavaScript (ESLint dan Prettier) lebih lambat daripada satu alat Rust native.
- **Dampak**: fitur 2 memasang konfigurasi dan hook.
- **Tinjau ulang bila**: Biome mendukung template Angular secara resmi.
- **Status**: terverifikasi.
