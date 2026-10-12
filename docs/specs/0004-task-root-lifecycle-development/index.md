# 0004. Task root dan lifecycle development

**Date**: 2026-10-12
**Status**: Proposed

## Summary

Semua pekerjaan sehari hari dijalankan lewat `bun run <task>` dari root, dengan katalog task di `docs/development.md` yang dijaga test agar selalu sama dengan `package.json`. `bun run dev` menjalankan frontend Angular, backend Axum, dan proxy `/api` sekaligus, membangun ulang backend saat kode Rust berubah, memisahkan log setiap layanan, melaporkan konflik port sebelum apa pun dinyalakan, dan menghentikan semua proses dengan bersih saat Anda menekan Ctrl+C atau mengetik `q`. Lifecycle ini didukung di macOS, Linux, dan Windows native, dan dibuktikan di CI ketiganya.

## Requirements

**User stories**:

- Sebagai developer, Anda cukup ingat satu tempat (`bun run`) untuk install, dev, build, lint, test, dan database.
- Sebagai developer, satu perintah menyalakan seluruh aplikasi lokal, dan berhenti tanpa meninggalkan proses yang memegang port.
- Sebagai developer Windows, Anda mendapat perilaku yang sama tanpa WSL.
- Sebagai pemelihara, Anda tahu task mana yang tersedia sekarang dan mana yang dicadangkan untuk fitur berikutnya.

**Acceptance criteria**:

1. **AC-1**: `docs/development.md` memuat katalog dengan format di spec ini. Test menolak bila ada script root yang tidak punya baris di tabel *Tersedia*, baris *Tersedia* yang tidak ada di `package.json` atau perintahnya berbeda, nama ganda, nama yang muncul di kedua tabel, nama *Dicadangkan* yang sudah terdaftar, prasyarat di luar nilai yang diizinkan, atau segmen `bun <file>` maupun `bun test` di script root yang tidak memakai `--no-env-file`.
2. **AC-2**: Dari clean checkout, `bun run check`, `bun run build`, dan `bun run test` lulus tanpa `.env` dan tanpa Docker, dan setelahnya `git status --porcelain` kosong. Task dengan prasyarat `env` atau `docker` dibuktikan oleh test fiturnya masing masing.
3. **AC-3**: `bun run dev` memuat env shell lalu `.env` root (atau `--env-file <path>`), menyalakan dev server Angular di `127.0.0.1:<WEB_DEV_PORT>` (default `4200`) dan backend di `APP_HOST:APP_PORT`, meneruskan request yang path-nya cocok `^/api(/|$)` ke backend tanpa mengubah path, menyajikan `/config.json` dari dev server, lalu mencetak `[dev] ready: web http://127.0.0.1:<WEB_DEV_PORT>, api http://<host>:<APP_PORT>` setelah keduanya siap (host IPv6 dalam kurung siku).
4. **AC-4**: Sebelum menyalakan proses anak, `dev` memvalidasi variabel dan memeriksa bahwa `WEB_DEV_PORT` dan `APP_PORT` bebas. Setiap masalah dilaporkan dengan teks dari tabel pesan, lalu `dev` keluar dengan status `1` tanpa menyalakan proses anak dan tanpa menulis ke `.dev/bin`.
5. **AC-5**: Saat file yang dipantau berubah, supervisor membangun ulang backend. Bila build lulus dan binary berubah, backend lama dihentikan, yang baru dinyalakan, dan `[dev] api restarted` dicetak setelah backend baru mencetak `api listening on`. Bila build gagal, error tampil dengan awalan `[api]`, `[dev] api build failed; previous backend keeps running` dicetak, dan backend lama tetap menjawab.
6. **AC-6**: Setiap baris keluaran proses anak (stdout dan stderr, termasuk keluaran `cargo`) diberi awalan `[web]` atau `[api]`, keluaran supervisor diberi awalan `[dev]`, dan keluaran mentah setiap layanan juga ditulis ke `<state-dir>/logs/web.log` dan `<state-dir>/logs/api.log` (default `.dev/`, diabaikan git, dikosongkan setiap kali preflight lulus).
7. **AC-7**: `SIGINT`, `SIGTERM`, `SIGHUP` (POSIX), Ctrl+C (Windows), atau baris `q` di stdin menghentikan semua proses anak beserta turunannya, lalu supervisor keluar dengan status `0`; setelah itu kedua port bisa di-bind dan tidak ada pid anak yang tersisa. Ctrl+C lewat `bun run dev` di terminal POSIX (yang mengirim `SIGINT` dua kali) tidak memaksa penghentian. Bila dev server berhenti sendiri, supervisor menghentikan semuanya dan keluar `1`. Bila backend berhenti sebelum siap pertama kali, supervisor menghentikan semuanya dan keluar `1`; bila berhenti setelahnya, supervisor mencetak status keluarnya dan menunggu perubahan berikutnya.
8. **AC-8**: `dev` tidak menyalakan atau mematikan Compose. Bila PostgreSQL di `127.0.0.1:<POSTGRES_PORT>` (default `15432`) tidak menerima koneksi TCP dalam 1 detik, `dev` mencetak `[dev] PostgreSQL is not reachable on 127.0.0.1:<port>; run "bun run db:up" when you need the database` lalu tetap berjalan; bila menerima, tidak ada peringatan.
9. **AC-9**: AC-3 sampai AC-8 dibuktikan oleh `tests/integration/dev.test.ts`, yang berjalan di CI pada Linux (job `checks`), macOS, dan Windows native (job `dev-lifecycle`), dengan port bebas, file env dan state dir sementara, tanpa `.env` developer dan tanpa Docker. Di Windows, penghentian yang dibuktikan adalah lewat `q`; Ctrl+C di Windows didukung tetapi tidak dibuktikan otomatis.

## Decision

**Chosen option**: Option 1, script Bun sebagai satu pintu task dan supervisor `dev` buatan sendiri dengan watcher polling bawaan, tanpa alat orkestrasi atau watcher tambahan.

Task didaftar hanya saat fiturnya benar benar jalan; nama task yang akan datang dicadangkan di katalog. Setiap script Bun memakai `--no-env-file` dan memuat `.env` hanya lewat `scripts/env-file.ts` (spec 0003).

**Implementation skills**: `angular-developer` (`angular/skills`, `~/.agents/skills/angular-developer/`)

## Feature design

### Format katalog `docs/development.md`

- Heading `## Tersedia` dan `## Dicadangkan`. Tabel dimulai di baris `|` pertama setelah heading dan berakhir sebelum heading berikutnya; baris header dan baris `---` dilewati.
- Tabel *Tersedia*: kolom `Task | Perintah | Tujuan | Prasyarat | Pemilik`. Satu baris per task. Nama task adalah token pertama di antara backtick pada kolom Task. Perintah adalah string script `package.json` persis, di antara backtick, dibandingkan sama persis. Prasyarat tepat salah satu `-`, `env`, `docker`, atau `env, docker`.
- Tabel *Dicadangkan*: kolom `Task | Tujuan | Pemilik`, satu baris per task.
- Install bukan script; dijelaskan di paragraf di atas tabel (`bun install`, CI memakai `bun ci`).
- Test `scripts/task-catalog.test.ts` mem-parse format ini dan menerapkan semua aturan AC-1.

Isi tabel *Tersedia* setelah fitur 1 sampai 5:

| Task | Perintah | Prasyarat | Pemilik |
| --- | --- | --- | --- |
| `prepare` | `bun --no-env-file scripts/install-hooks.ts` | - | Fitur 2 |
| `dev` | `bun --no-env-file scripts/dev.ts` | env | Fitur 4 |
| `build` | `bun run build:api && bun run build:web` | - | Fitur 4 |
| `build:api` | `cargo build --locked -p api` | - | Fitur 1 |
| `build:web` | `bun run --filter web build` | - | Fitur 1 |
| `run:api` | `bun --no-env-file scripts/run-api.ts` | env | Fitur 4 |
| `check` | `bun run format:check && bun run lint && bun run typecheck && bun run check:generated` | - | Fitur 2 |
| `format` | `prettier --write . && cargo fmt --all` | - | Fitur 2 |
| `format:check` | `prettier --check . && cargo fmt --all --check` | - | Fitur 2 |
| `lint` | `eslint . --max-warnings 0 && cargo clippy --locked --workspace --all-targets -- -D warnings` | - | Fitur 2 |
| `typecheck` | `tsc -p scripts/tsconfig.json && tsc -p tests/tsconfig.json && bun run --filter web typecheck` | - | Fitur 2 dan 5 |
| `check:generated` | `bun --no-env-file scripts/check-generated.ts` | - | Fitur 2 |
| `test` | `bun run test:scripts && bun run test:web && bun run test:api` | - | Fitur 4 |
| `test:scripts` | `bun test --no-env-file` | - | Fitur 1 |
| `test:web` | `bun run --filter web test` | - | Fitur 1 |
| `test:api` | `cargo test --locked --workspace` | - | Fitur 4 |
| `test:integration` | `bun test --no-env-file ./tests/integration` | docker | Fitur 4 |
| `db:up` | `bun --no-env-file scripts/db.ts up` | env, docker | Fitur 5 |
| `db:down` | `bun --no-env-file scripts/db.ts down` | env, docker | Fitur 5 |
| `db:status` | `bun --no-env-file scripts/db.ts status` | env, docker | Fitur 5 |
| `db:reset` | `bun --no-env-file scripts/db.ts reset` | env, docker | Fitur 5 |

Kolom Tujuan diisi satu kalimat per task di dokumen. Tabel *Dicadangkan*: `test:e2e` (fitur 18 dan 24), `contract:generate` dan `contract:check` (fitur 11 sampai 13), `db:migrate` dan `db:migrate:status` (fitur 6), `db:seed` (fitur 17), `build:profile-a` dan `smoke:profile-a` (fitur 30), `build:profile-b` dan `smoke:profile-b` (fitur 31), masing masing satu baris. Fitur pemilik memindahkan barisnya ke *Tersedia* saat mendaftarkan script.

Perubahan script yang dilakukan fitur ini: `prepare` dan `check:generated` mendapat `--no-env-file`; `test:scripts` menjadi `bun test --no-env-file`; `dev`, `build`, `run:api`, `test`, `test:api`, `test:integration` ditambahkan. Assertion `prepare` di `scripts/tooling.test.ts` diperbarui.

`docs/development.md` juga menjelaskan: Ctrl+C dan `q`; perubahan `.env` atau `proxy.conf.mjs` butuh restart `dev`; backend yang tidak hidup menghasilkan 502 dari proxy; `test:api` memakai port `3000` tetap untuk test kerangka sehingga `dev` dengan `APP_PORT=3000` harus dihentikan dulu; supervisor yang dibunuh paksa (`SIGKILL`) bisa meninggalkan proses anak yang lalu terdeteksi sebagai konflik port.

### Tata letak test

- Test cepat di `scripts/*.test.ts` (`[test] root = "scripts"` di `bunfig.toml`), dijalankan `test:scripts`.
- Test lambat di `tests/integration/`: `scripts/clean-checkout.test.ts` pindah ke `tests/integration/clean-checkout.test.ts` (import helper disesuaikan), `tests/integration/postgres.test.ts` (spec 0003), dan `tests/integration/dev.test.ts` (baru). Folder ini hanya jalan bila disebut eksplisit dengan awalan `./`.
- `tests/tsconfig.json` (spec 0003) mencakup file baru ini.

### Variabel development

| Variabel | Tujuan | Wajib | Default | Secret | Validasi |
| --- | --- | --- | --- | --- | --- |
| `WEB_DEV_PORT` | Port dev server Angular | opsional | `4200` | bukan | Bilangan bulat `1024` sampai `65535`, berbeda dari `APP_PORT` |

Bagian `.env.example` setelah bagian spec 0003:

```
# --- Development lifecycle (spec 0004) ---
# Port of the Angular dev server started by bun run dev. optional, default 4200, not secret.
WEB_DEV_PORT=4200
```

`dev` juga memakai `APP_ENV`, `APP_HOST`, `APP_PORT` (spec 0002) dan `POSTGRES_PORT` dengan `DEFAULT_POSTGRES_PORT` (spec 0003), dan mewajibkan `APP_ENV=development`.

### Opsi `dev`

| Opsi | Arti |
| --- | --- |
| `--env-file <path>` atau `--env-file=<path>` | File env selain `.env` root; wajib ada |
| `--state-dir <path>` atau `=` | Folder state (log, salinan binary), default `.dev` |
| `--api-dir <path>` atau `=` | Root workspace Cargo yang dibangun dan dipantau, default root repo |

Opsi lain menghasilkan `[dev] unknown option: <arg>` dan status `1`. `--state-dir` dan `--api-dir` ada terutama untuk test.

### Tabel pesan `[dev]`

Pesan fatal ke stderr, lainnya ke stdout.

| Kondisi | Pesan | Status |
| --- | --- | --- |
| `.env` default tidak ada | `[dev] .env not found; copy .env.example to .env and fill in the values` | 1 |
| `--env-file` tidak ada | `[dev] env file not found: <path>` | 1 |
| Validasi | `[dev] APP_ENV: must be development for bun run dev`, `[dev] APP_HOST: must be an IPv4 or IPv6 address literal`, `[dev] APP_PORT: must be an integer from 1 to 65535`, `[dev] WEB_DEV_PORT: must be an integer from 1024 to 65535`, `[dev] WEB_DEV_PORT: must differ from APP_PORT`, `[dev] POSTGRES_PORT: must be an integer from 1024 to 65535` (semua masalah dilaporkan) | 1 |
| Port terpakai | `[dev] <VAR>=<port> is already in use (<KODE>); set <VAR> in .env` dengan `<KODE>` dari error bind (`EADDRINUSE`, `EACCES`, `EADDRNOTAVAIL`) atau `accepting connections` | 1 |
| Database tidak terjangkau | Pesan AC-8 | lanjut |
| Build | `[dev] building api` | lanjut |
| Build pertama gagal | `[dev] api build failed` lalu `[dev] stopping` dan `[dev] stopped` | 1 |
| Build ulang gagal | `[dev] api build failed; previous backend keeps running` | lanjut |
| Proses dinyalakan | `[dev] started api (pid <n>)`, `[dev] started web (pid <n>)` | lanjut |
| Siap | Pesan AC-3 | lanjut |
| Reload sukses | `[dev] api restarted` | lanjut |
| Backend berhenti setelah siap | `[dev] api exited with status <n>; waiting for changes` | lanjut |
| Backend berhenti sebelum siap | `[dev] api exited with status <n> before it was ready; stopping` | 1 |
| Dev server berhenti | `[dev] web exited with status <n>; stopping` | 1 |
| Batas siap | `[dev] not ready after 120 seconds; stopping` | 1 |
| Penghentian | `[dev] stopping`, lalu `[dev] stopped`; bila dipaksa juga `[dev] forcing stop` | 0 bila dipicu pengguna |

### Supervisor `scripts/dev.ts`

Urutan start:

1. Parse opsi. Muat env lewat `loadEnvFile` (spec 0003): `--env-file` memakai `required: true`; default `.env` wajib ada untuk `dev`.
2. Validasi variabel (tabel pesan), lalu periksa port: untuk setiap port, buka listener `node:net` di host yang akan dipakai (`127.0.0.1` untuk web, `APP_HOST` untuk api) lalu tutup, dan coba koneksi TCP 200 ms ke `127.0.0.1:<port>` (diterima berarti terpakai). Semua konflik dilaporkan sekaligus.
3. Kosongkan `<state-dir>/logs/`, hapus isi `<state-dir>/bin/`.
4. Periksa PostgreSQL dengan satu koneksi `node:net` berbatas 1000 ms.
5. Build pertama: `cargo build --locked -p api --message-format=json-render-diagnostics` dengan cwd `--api-dir`; path binary diambil dari pesan JSON `compiler-artifact` (menghormati `CARGO_TARGET_DIR`); diagnostik yang dirender diteruskan ke `[api]`.
6. Salin binary ke `<state-dir>/bin/api-<run>-<n>` (ditambah `.exe` di Windows, `<run>` pid supervisor, `<n>` nomor build) dan jalankan salinan itu, agar build berikutnya bisa menimpa binary asli walaupun proses lama hidup. Salinan dihapus setelah prosesnya berhenti (Windows: diulang beberapa kali bila masih terkunci).
7. Backend dijalankan dengan env hasil langkah 1. Dev server dijalankan dengan `bun run --cwd apps/web start -- --host 127.0.0.1 --port <WEB_DEV_PORT>` (guard Node spec 0001 tetap berjalan) dan env tambahan `DEV_API_TARGET=http://<host>:<APP_PORT>`, dengan host `127.0.0.1` bila `APP_HOST` adalah `0.0.0.0`, `::1` dalam kurung siku untuk IPv6, dan `127.0.0.1` untuk `::`.
8. Siap: backend mencetak `api listening on`, dan `GET /` ke dev server menjawab 200 (polling setiap 250 ms, batas per request 1 detik). Batas 120 detik dihitung sejak build pertama selesai.

Proses anak:

- `stdin: 'ignore'`, stdout dan stderr dipipe.
- POSIX: dijalankan `detached: true` sehingga punya process group sendiri. Penghentian: `SIGTERM` ke group (`process.kill(-pid)`), tunggu sampai 10 detik (5 detik untuk reload), lalu `SIGKILL` ke group dan tunggu paling lama 2 detik.
- Windows: dijalankan `detached: true`. Penghentian langsung `taskkill /PID <pid> /T /F`, karena `taskkill` tanpa `/F` tidak bisa menghentikan proses konsol.
- Build `cargo` yang sedang berjalan saat penghentian ikut dihentikan dengan cara yang sama.
- Setelah pemicu berhenti, setiap proses anak yang keluar dianggap wajar.

Pemicu berhenti: `SIGINT`, `SIGTERM`, `SIGHUP` (POSIX), Ctrl+C dan Ctrl+Break (Windows), dan baris stdin yang setelah `trim` dan huruf kecil sama dengan `q` (dibaca dengan `readline`, tanpa raw mode). EOF atau stdin tertutup tidak menghentikan apa pun. Pemicu ulang dalam 1,5 detik pertama diabaikan; pemicu ulang setelah itu memaksa penghentian. Setelah semua anak berhenti, supervisor menutup stdin dan memanggil `process.exit` dengan status yang sesuai.

Proxy: `apps/web/proxy.conf.mjs` membaca `process.env.DEV_API_TARGET` (melempar error bila kosong, tanpa default) dan mengekspor `export default { '^/api(/|$)': { target, secure: false, changeOrigin: false } }` tanpa `pathRewrite`. Loader Angular hanya mengenali `export default`, sehingga file ini diberi komentar pengecualian aturan ekspor bernama di `AGENTS.md`. `angular.json` menambah `"proxyConfig": "proxy.conf.mjs"` di `serve.options`.

Watcher (AC-5): polling mtime setiap 500 ms atas semua file di bawah `<api-dir>/apps/api` dan `<api-dir>/crates` (bila ada, termasuk bila dibuat setelah start), serta `<api-dir>/Cargo.toml` dan `<api-dir>/Cargo.lock`, mengabaikan `target/`, file `*.md`, dan file sementara editor (`.#*`, `*~`, `*.swp`, `4913`). Perubahan apa pun menjadwalkan build; perubahan selama build menjadwalkan satu build lagi sesudahnya. Restart hanya bila mtime binary hasil build berubah. Backend baru yang gagal start mencetak pesan status keluar lalu menunggu perubahan berikutnya.

Log (AC-6): stdout dan stderr setiap anak dipecah per baris dengan buffer (CR dibuang, sisa baris dikirim saat proses berakhir), diberi awalan yang sama, ditulis ke terminal, dan disalin ke file log layanannya. Tanpa timestamp. `.dev/` ditambahkan ke `.gitignore` dan `.prettierignore`.

### Script `scripts/run-api.ts`

Memuat env seperti langkah 1 (`.env` default boleh tidak ada), lalu menjalankan `cargo run --locked -p api` dengan env itu. Script mengabaikan `SIGINT` untuk dirinya sendiri (proses `cargo` yang menerima sinyal dari terminal) dan keluar dengan status anak, atau `128 + n` bila anak mati karena sinyal.

### Portabilitas test lama

Sebelum job Windows dan macOS diaktifkan, test di `scripts/` diaudit: skenario PATH tanpa `node` di `guard-node.test.ts` dilewati di Windows (`test.skipIf(process.platform === 'win32')` dengan alasan tertulis); `pins.test.ts` menjalankan `npm` dengan `shell: true` di Windows; test symlink di `generated.test.ts` dilewati di Windows; pemeriksaan bit executable hook di `tooling.test.ts` diganti pemeriksaan mode git `100755` lewat `git ls-files -s`. `.gitattributes` menjadi `* text=auto eol=lf` ditambah aturan `*.sh text eol=lf` dari spec 0003, agar Prettier dan hook tidak gagal karena CRLF di checkout Windows.

### CI

- Job `checks` (`ubuntu-24.04`): langkah test menjadi `bun run test` lalu `bun run test:integration`.
- Job baru `dev-lifecycle` dengan `strategy.fail-fast: false`, `timeout-minutes: 45`, matrix `os: [macos-15, windows-2025]` (bila GitHub menolak label itu, pakai `macos-latest` dan `windows-latest`): checkout, setup Node, Bun, Rust, cache Bun, `bun ci`, `bun run check`, `bun run test`, lalu `bun test --no-env-file ./tests/integration/dev.test.ts`.
- `scripts/tooling.test.ts` memeriksa workflow per job: setiap job memakai action yang dipin spec 0001, perintah pertama `bun ci`, dan setiap perintah berikutnya adalah `bun run <script terdaftar>`, `cargo ... --locked`, atau `bun test --no-env-file ./tests/integration/dev.test.ts`; matrix `dev-lifecycle` berisi macOS dan Windows.

### Test `tests/integration/dev.test.ts`

- Env anak dibangun dari allowlist (PATH, HOME, USERPROFILE, SYSTEMROOT, TEMP, TMP, dan variabel yang dibutuhkan toolchain), bukan salinan penuh; `NODE_ENV`, `GIT_*`, `APP_*`, `WEB_DEV_PORT`, `POSTGRES_*`, `DATABASE_*`, `COMPOSE_*` tidak diwarisi.
- File env sementara berisi `APP_ENV=development`, `APP_HOST=127.0.0.1`, dua port bebas berbeda dari bind ke port `0`, `POSTGRES_PORT` ke port bebas yang tertutup, dan `DATABASE_URL=postgres://app:placeholder@127.0.0.1:5432/app_test`. Setiap test memakai `--state-dir` sementara.
- Batas waktu per test eksplisit (pola `STEP_TIMEOUT_MS` test clean checkout).
- Skenario reload memakai `--api-dir` ke workspace Cargo sementara dengan package `api` yang hanya memakai `std` (`TcpListener` di `APP_HOST:APP_PORT`, mencetak `api listening on http://<alamat>`, menjawab HTTP 404), `Cargo.lock` dibuat dengan `cargo generate-lockfile --offline`; test mengubah file sumbernya untuk restart dan menulis kode rusak untuk build gagal. File repo tidak pernah diubah.
- Penghentian dibuktikan lewat pid dari baris `[dev] started ... (pid n)`: setelah keluar, `process.kill(pid, 0)` melempar untuk semua pid dan kedua port bisa di-bind. Skenario POSIX tambahan menjalankan `bun run dev` dan mengirim `SIGINT` ke process group (meniru Ctrl+C terminal) dan memastikan tidak ada `[dev] forcing stop`.
- AC-8: kasus port tertutup (ada peringatan) dan kasus socket yang mendengarkan (tanpa peringatan).

`tests/integration/clean-checkout.test.ts` membuktikan AC-2: setelah `bun ci`, jalankan `bun run check`, `bun run build`, `bun run test`, lalu `git status --porcelain` kosong. `scripts/task-catalog.test.ts` membuktikan AC-1.

**Data model sketch**: Tidak ada data persisten.

**API surface**: Tidak ada endpoint baru; permukaannya katalog task, opsi `dev`, dan pesan `[dev]`.

**Value sourcing**:

| Aksi | Nilai | Sumber |
| --- | --- | --- |
| Menyalakan backend | Host, port, lingkungan | `APP_HOST`, `APP_PORT`, `APP_ENV` (spec 0002) |
| Menyalakan dev server | Port | `WEB_DEV_PORT`, default `4200` |
| Proxy | Target | `DEV_API_TARGET` yang dihitung supervisor dari `APP_HOST` dan `APP_PORT` |
| Cek database | Port | `POSTGRES_PORT`, default `DEFAULT_POSTGRES_PORT` (spec 0003) |
| Pemuatan env | File | `.env` root atau `--env-file`, lewat `scripts/env-file.ts` (spec 0003) |
| Path binary | Path | Pesan JSON `compiler-artifact` dari `cargo build` |
| Tanda siap backend | Baris log | `api listening on http://...` (spec 0002) |
| Nama task database | Nama | Spec 0003 |

**Key invariants**:

- Setiap script root terdaftar di katalog dan sebaliknya; setiap script Bun memakai `--no-env-file`.
- `dev` tidak pernah menyalakan proses anak bila preflight gagal, dan tidak meninggalkan proses anak setelah keluar normal.
- `dev` tidak pernah menyentuh Compose atau data database.
- Angular selalu dijalankan lewat script web yang dijaga guard Node.

**Security model**: Lifecycle ini hanya untuk development. Dev server dan backend listen di loopback kecuali `APP_HOST` diubah. `dev` menolak `APP_ENV` selain `development`. Secret di `.env` tidak dicetak supervisor.

**Configuration required**: `WEB_DEV_PORT` (baru) dan `DEV_API_TARGET` (dibuat supervisor, tidak diisi manusia).

**Critical test scenarios**: lihat bagian Test; setiap AC punya skenario di sana.

## Build plan

Tracer Bullet: satu perintah yang benar benar menyalakan web dan api lebih dulu, lalu reload, log, penghentian, katalog, dan CI.

1. `scripts/dev.ts` dengan opsi, pemuatan env, validasi, preflight port dan database, build pertama, salinan binary, start backend dan dev server; `proxy.conf.mjs`, `proxyConfig`, `WEB_DEV_PORT` di `.env.example`, satisfies **AC-3**, **AC-4**, **AC-8**.
2. Penghentian lintas OS, pemicu stdin dan sinyal dengan jeda 1,5 detik, penanganan anak yang berhenti sendiri, satisfies **AC-7**.
3. Watcher polling, build ulang, log berawalan dan file log, satisfies **AC-5**, **AC-6**.
4. `scripts/run-api.ts`; perubahan dan penambahan script root; pemindahan test clean checkout; `docs/development.md`; `.gitattributes`; `.dev/` di ignore, satisfies **AC-1**, **AC-2**.
5. Audit portabilitas test lama, `tests/integration/dev.test.ts`, `scripts/task-catalog.test.ts`, pembaruan `scripts/tooling.test.ts`, dan job CI `dev-lifecycle`, satisfies **AC-1** sampai **AC-9**.

## Consequences

**Positive**:

- Satu pintu task tanpa alat tambahan, dengan katalog yang tidak bisa basi diam diam.
- Reload backend tanpa memasang apa pun di luar repo.
- Perilaku dev dibuktikan di tiga OS.

**Negative**:

- Supervisor buatan sendiri (proses lintas OS, polling, log) adalah kode yang harus dirawat.
- CI bertambah dua runner yang lebih lambat dan mahal.
- Polling 500 ms memakai sedikit CPU dan memberi jeda reload sampai setengah detik.

**Neutral**:

- Task fitur berikutnya ditambahkan fiturnya sendiri lewat katalog.
- Hook pre-commit tetap hanya menjalankan `check`.

## Follow-up

- [ ] Fitur 35 memakai `docs/development.md` sebagai dasar README quickstart.
- [ ] Bila job `dev-lifecycle` menjadi hambatan waktu, fitur 28 menimbang menjalankannya hanya saat merge.

## Rationale

Konteks, opsi, dan alasan ada di [rationale.md](rationale.md).
