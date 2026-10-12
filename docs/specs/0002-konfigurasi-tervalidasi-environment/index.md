# 0002. Konfigurasi tervalidasi dan environment

**Date**: 2026-10-12
**Status**: In Progress

## Summary

Backend membaca seluruh konfigurasinya dari environment proses, memeriksanya sekali saat start, dan menolak berjalan bila ada yang hilang, tidak valid, atau tidak aman untuk staging dan production. Secret (misalnya password database) tidak pernah tercetak, boleh dikirim lewat file, dan tidak pernah ada di repo; `.env.example` mendokumentasikan setiap variabel tanpa nilai rahasia. Frontend mendapat API base URL dari file publik `config.json` saat runtime, sehingga satu build Angular dapat dipakai di semua lingkungan dan kedua profil deployment tanpa secret di bundle. Spec ini menggantikan alamat tetap dan "tanpa konfigurasi" pada AC-7 spec 0001.

## Requirements

**User stories**:

- Sebagai developer, Anda menyalin `.env.example` menjadi `.env`, mengisi credential lokal, dan backend langsung menyebut setiap variabel yang salah dalam satu kali start.
- Sebagai operator, Anda tidak bisa tanpa sengaja menjalankan production dengan cookie tanpa Secure, origin CORS `http://`, seed development, atau koneksi database tanpa TLS.
- Sebagai pemilik keamanan, Anda yakin password database tidak muncul di log, pesan error, maupun bundle Angular, dan frontend tidak bisa diarahkan ke origin lain lewat URL yang menipu.
- Sebagai pengelola deployment, Anda mengganti API base URL frontend per lingkungan tanpa build ulang.

**Acceptance criteria**:

1. **AC-1**: Saat start, backend memuat konfigurasi sebelum membuka listener. Bila ada masalah, proses keluar dengan status `78` tanpa membuka port, stdout kosong, dan stderr berisi tepat baris `configuration error:` diikuti paling banyak satu baris per variabel berformat `  <NAMA>: <pesan>` dengan teks dari tabel pesan di spec ini, dalam urutan tabel skema. Semua variabel bermasalah dilaporkan dalam satu kali start, tanpa stack trace dan tanpa panic. Nilai `*` di `CORS_ALLOWED_ORIGINS` selalu ditolak.
2. **AC-2**: Dengan hanya `APP_ENV=development` dan `DATABASE_URL` yang valid, backend listen di `127.0.0.1:3000` dan mencetak `api listening on http://127.0.0.1:3000`. `APP_HOST` dan `APP_PORT` mengganti alamat itu, dan baris start memakai alamat yang benar benar di-bind (IPv6 dengan kurung siku, misalnya `http://[::1]:3000`). Kegagalan bind tetap menghasilkan pesan `cannot bind <alamat>: <error>` dari spec 0001.
3. **AC-3**: Bila `APP_ENV` adalah `staging` atau `production`, backend menolak start (status `78`) untuk `COOKIE_SECURE=false`, `DEV_SEED_ENABLED=true`, origin `http://` di `CORS_ALLOWED_ORIGINS`, `WEB_API_BASE_URL` berupa URL `http://`, serta `DATABASE_URL` atau `DATABASE_MIGRATOR_URL` tanpa tepat satu parameter `sslmode` bernilai `require`, `verify-ca`, atau `verify-full`. Nilai yang sama diterima pada `development` dan `test`.
4. **AC-4**: Nilai `DATABASE_URL` dan `DATABASE_MIGRATOR_URL`, termasuk password di dalamnya, tidak pernah muncul di stdout atau stderr backend, baik saat start sukses maupun saat nilainya tidak valid; representasi debug konfigurasi menampilkan `[redacted]`. Setiap secret dapat diisi lewat `<NAMA>_FILE` dengan semantik di spec ini; mengisi keduanya ditolak, dan masalah file dilaporkan dengan nama variabel dan path file, bukan isinya.
5. **AC-5**: `.env.example` di root diawali bagian backend yang isinya sama persis dengan blok di spec ini (urutan, komentar, nilai contoh, secret kosong). Bagian lain (spec 0003, 0004) hanya boleh ada setelah baris penanda `# --- `. `.env` dan file `.env.*` lain diabaikan git, kecuali `.env.example`. Test Rust menolak bila skema di kode dan bagian backend `.env.example` tidak sama.
6. **AC-6**: Aplikasi Angular mengambil `/config.json` (tanpa cache, batas waktu 5 detik) sebelum bootstrap. File default di build berisi `{ "apiBaseUrl": "/api" }`. Nilai `apiBaseUrl` tersedia lewat injection token `APP_CONFIG`. Mengganti `config.json` di output build mengubah nilai itu tanpa build ulang. Bila file tidak bisa diambil, bukan JSON objek, memuat kunci selain `apiBaseUrl`, atau nilainya melanggar aturan URL bersama, aplikasi tidak bootstrap dan `app-root` menampilkan teks `Application configuration could not be loaded. Check /config.json and reload the page.` dengan `role="alert"`.
7. **AC-7**: Bundle Angular tidak memuat konfigurasi backend: build dengan `DATABASE_URL` dan `DATABASE_MIGRATOR_URL` berisi penanda unik tidak menghasilkan file di `apps/web/dist/` yang memuat penanda itu atau pola `postgres://` atau `postgresql://`. Workspace web tidak punya file `environment*.ts`, `angular.json` tidak memuat kunci `fileReplacements` atau `define` di mana pun, dan `apps/web/src` tidak memakai `process.env`.

## Decision

**Chosen option**: Option 1, environment proses sebagai satu satunya sumber konfigurasi backend, parser bertipe tanpa crate tambahan, secret lewat env atau `<NAMA>_FILE`, dan `config.json` publik saat runtime untuk frontend.

Backend tidak membaca file konfigurasi apa pun selain file yang ditunjuk `<NAMA>_FILE`; frontend tidak menanam konfigurasi apa pun saat build.

**Implementation skills**: `angular-developer` (`angular/skills`, `~/.agents/skills/angular-developer/`) · `ng22-vitest` (`pavananguluri/angular22-agent-skills`, `.claude/skills/ng22-vitest/`)

## Feature design

### Skema konfigurasi backend

Semua variabel dibaca sekali saat start, jadi setiap perubahan butuh restart. Server memvalidasi semua baris tabel; variabel opsional hanya divalidasi bila diisi.

| Variabel | Tujuan | Wajib | Default | Secret | Validasi | Dipakai oleh |
| --- | --- | --- | --- | --- | --- | --- |
| `APP_ENV` | Lingkungan berjalan | wajib | tidak ada | bukan | Tepat `development`, `test`, `staging`, atau `production` | server |
| `APP_HOST` | Alamat bind | opsional | `127.0.0.1` | bukan | Literal IPv4 atau IPv6 tanpa kurung siku dan tanpa zone id (`0.0.0.0` dan `::` boleh) | server |
| `APP_PORT` | Port bind | opsional | `3000` | bukan | Bilangan bulat `1` sampai `65535` | server |
| `DATABASE_URL` | Koneksi role runtime | wajib | tidak ada | secret, boleh `DATABASE_URL_FILE` | Grammar URL database di bawah; staging dan production: aturan `sslmode` | server (koneksi dibuka fitur 6) |
| `DATABASE_MIGRATOR_URL` | Koneksi role migrator | opsional bagi server, wajib bagi perintah migration | tidak ada | secret, boleh `DATABASE_MIGRATOR_URL_FILE` | Sama dengan `DATABASE_URL` | perintah migration (fitur 6) |
| `COOKIE_SECURE` | Atribut `Secure` cookie sesi | opsional | `true` | bukan | `true` atau `false`; staging dan production wajib `true` | fitur 14 dan 18 |
| `CORS_ALLOWED_ORIGINS` | Origin lain yang boleh memanggil API dengan credential | opsional | kosong (same origin saja) | bukan | Grammar origin di bawah, dipisah koma; `*` selalu ditolak; staging dan production hanya `https://` | fitur 26, Profil A origin terpisah |
| `DEV_SEED_ENABLED` | Izin seed development | opsional | `false` | bukan | `true` atau `false`; staging dan production wajib `false` | fitur 17 |
| `WEB_API_BASE_URL` | Nilai `apiBaseUrl` untuk `config.json` | opsional | `/api` | bukan (publik) | Aturan URL bersama; staging dan production hanya path atau `https://` | fitur 30 dan 31 |

Variabel yang tidak ada di tabel diabaikan. Fitur berikutnya menambah baris lewat spec mereka dengan aturan yang sama.

### Aturan umum nilai

Urutan pemeriksaan per variabel; pemeriksaan pertama yang gagal menjadi satu satunya baris untuk variabel itu:

1. Sumber: `<NAMA>` dan `<NAMA>_FILE` sama sama berisi (keduanya tidak kosong) adalah konflik; masalah membaca file.
2. Nilai env bukan UTF-8.
3. Nilai kosong (`NAMA=` atau `NAMA_FILE=`) sama dengan tidak diisi; variabel wajib yang tidak diisi gagal di sini.
4. Spasi di awal atau akhir nilai (`char::is_whitespace`) ditolak.
5. Grammar atau rentang.
6. Aturan lingkungan (staging dan production). Aturan ini dilewati bila `APP_ENV` sendiri hilang atau tidak valid; baris `APP_ENV` tetap dilaporkan.

Boolean hanya menerima `true` atau `false` huruf kecil.

### Semantik `<NAMA>_FILE`

- Berlaku untuk `DATABASE_URL` dan `DATABASE_MIGRATOR_URL`.
- Isi file dibaca sebagai byte, maksimal 8 KiB, harus UTF-8. Tepat satu `\n` atau `\r\n` di akhir dibuang; spasi lain di awal atau akhir ditolak oleh aturan umum.
- Isi kosong atau hanya baris baru ditolak sebagai file kosong.
- Pesan file selalu menyebut path apa adanya (path bukan secret) dan tidak pernah menyertakan isi file atau teks error OS.
- Kesalahan isi (grammar, `sslmode`) dilaporkan dengan nama variabel utama, misalnya `DATABASE_URL`.

### Grammar URL database (tanpa crate)

- Skema tepat `postgres://` atau `postgresql://` huruf kecil.
- Authority sampai `/` pertama setelah skema berbentuk `user[:password]@host[:port]`, dengan tepat satu `@`.
- `user` tidak kosong; `password` boleh kosong.
- Userinfo, nama database, dan nilai query tidak boleh memuat spasi mentah, karakter kontrol, atau `@`, `/`, `?`, `#` yang tidak di-encode. Setiap `%` harus diikuti dua digit heksadesimal. Nilai tidak pernah di-decode untuk dicetak.
- `host` tidak kosong: nama host `[A-Za-z0-9.-]+`, IPv4, atau IPv6 dalam kurung siku. Daftar host dengan koma dan bentuk unix socket (host kosong) ditolak.
- `port` opsional, `1` sampai `65535`.
- Path `/` diikuti nama database tidak kosong tanpa `/` lagi.
- Query opsional `?k=v&k=v`; kunci di-decode untuk dibandingkan. Kunci `ssl-mode` dan `ssl_mode` ditolak, `sslmode` paling banyak satu kali. Kunci lain diteruskan apa adanya.
- Fragment `#` ditolak.
- Staging dan production: `sslmode` wajib ada tepat satu kali dengan nilai `require`, `verify-ca`, atau `verify-full` (huruf kecil, dibandingkan persis).

### Grammar origin CORS

Setiap item (dipisah koma, tanpa spasi, tanpa item kosong, duplikat boleh): skema `http` atau `https` huruf kecil, lalu `://`, host huruf kecil `[a-z0-9.-]+` atau IPv6 dalam kurung siku, port opsional `1` sampai `65535` yang bukan port default skema (`:80` untuk `http`, `:443` untuk `https`), tanpa userinfo, path, query, atau garis miring akhir. Item `*` di mana pun menghasilkan pesan wildcard.

### Aturan URL bersama (`WEB_API_BASE_URL` dan `apiBaseUrl`)

Diterapkan sama di Rust dan TypeScript. Nilai valid bila tidak memuat spasi, karakter kontrol, atau `\`, dan salah satu dari:

- Path: diawali tepat satu `/` (bukan `//`), minimal satu karakter setelahnya, tanpa `?`, `#`, atau garis miring akhir.
- URL: skema `http://` atau `https://` huruf kecil, host tidak kosong, tanpa userinfo, query, fragment, atau garis miring akhir (path opsional).

Frontend menerima `http://` karena tidak tahu lingkungannya; server menolak URL `http://` untuk `WEB_API_BASE_URL` pada staging dan production.

Vektor uji bersama (dipakai test Rust dan Vitest):

| Valid | Tidak valid |
| --- | --- |
| `/api`, `/api/v1`, `https://api.example.com`, `https://api.example.com:8443/base`, `http://localhost:3000` | kosong, `/`, `/api/`, `//evil.example`, `/\evil.example`, `api`, `https://user:pass@api.example.com`, `https://`, `HTTP://api.example.com`, `https://api.example.com/?x=1`, `https://api.example.com#f`, `ftp://example.com`, ` /api`, `/a pi` |

### Tabel pesan error backend

| Variabel | Kondisi | Pesan (setelah `<NAMA>: `) |
| --- | --- | --- |
| semua | `<NAMA>` dan `<NAMA>_FILE` diisi | `set either <NAMA> or <NAMA>_FILE, not both` |
| `*_FILE` | file tidak bisa dibaca | (baris memakai `<NAMA>_FILE: `) `cannot read file "<path>"` |
| `*_FILE` | file kosong | (`<NAMA>_FILE: `) `file is empty` |
| `*_FILE` | lebih dari 8 KiB | (`<NAMA>_FILE: `) `file is larger than 8 KiB` |
| `*_FILE` | bukan UTF-8 | (`<NAMA>_FILE: `) `file is not valid UTF-8` |
| semua | env bukan UTF-8 | `must be valid UTF-8` |
| wajib | tidak diisi | `is required` |
| semua | spasi di awal atau akhir | `must not start or end with whitespace` |
| `APP_ENV` | nilai lain | `must be one of development, test, staging, production` |
| `APP_HOST` | bukan literal IP | `must be an IPv4 or IPv6 address literal` |
| `APP_PORT` | di luar rentang | `must be an integer from 1 to 65535` |
| URL database | grammar | `must be a postgres:// or postgresql:// URL with user, host, and database name` |
| URL database | `sslmode` ganda atau alias | `use the sslmode query parameter at most once and no ssl-mode or ssl_mode aliases` |
| URL database | aturan lingkungan | `sslmode must be require, verify-ca, or verify-full when APP_ENV is staging or production` |
| `COOKIE_SECURE`, `DEV_SEED_ENABLED` | bukan boolean | `must be true or false` |
| `COOKIE_SECURE` | aturan lingkungan | `must be true when APP_ENV is staging or production` |
| `DEV_SEED_ENABLED` | aturan lingkungan | `must be false when APP_ENV is staging or production` |
| `CORS_ALLOWED_ORIGINS` | ada `*` | `* is not allowed` |
| `CORS_ALLOWED_ORIGINS` | grammar | `must be a comma-separated list of http:// or https:// origins without path, query, or trailing slash` |
| `CORS_ALLOWED_ORIGINS` | aturan lingkungan | `must use https:// origins when APP_ENV is staging or production` |
| `WEB_API_BASE_URL` | grammar | `must be a path starting with / or an http:// or https:// URL, without query, fragment, or trailing slash` |
| `WEB_API_BASE_URL` | aturan lingkungan | `must be a path or an https:// URL when APP_ENV is staging or production` |

Pesan tidak pernah menyalin nilai yang diberikan, kecuali path file pada baris `*_FILE`.

### Implementasi backend

- Modul `apps/api/src/config.rs` memuat konstanta `SCHEMA` (nama, wajib, default, secret, punya varian `_FILE`), struct `Config` (`#[derive(Debug)]`), tipe `Secret(String)` dengan `expose(&self) -> &str` serta `Debug` dan `Display` manual yang mencetak `[redacted]` (tanpa `Serialize` dan `PartialEq`), dan fungsi murni `Config::load(read_var, read_file)`. `read_var: Fn(&str) -> Result<Option<String>, NotUnicode>`; `read_file: Fn(&Path) -> io::Result<Vec<u8>>`. Hasilnya `Result<Config, Vec<ConfigError>>`.
- Field yang belum dibaca kode lain diberi `#[allow(dead_code)]` dengan komentar yang menyebut fitur pemakainya (6, 14, 17, 26, 30, 31).
- `main` memanggil `Config::load` dengan `std::env::var_os` dan `std::fs::read`. Gagal: tulis header dan baris ke stderr memakai `writeln!` yang hasilnya diabaikan (`eprintln!` dapat panic bila stderr tertutup), lalu kembalikan `ExitCode::from(78)`. Sukses: bind `SocketAddr` dari `APP_HOST` dan `APP_PORT`; kegagalan bind tetap panic dengan pesan `cannot bind {addr}: {error}`; cetak `api listening on http://{listener.local_addr()}`.
- Server belum membuka koneksi database.

### Konfigurasi frontend

- `apps/web/public/config.json` berisi `{ "apiBaseUrl": "/api" }`.
- `apps/web/src/app/config/app-config.ts` mengekspor (ekspor bernama saja):
  - `interface AppConfig { apiBaseUrl: string }`;
  - `const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG')`;
  - `validateAppConfig(raw: unknown): AppConfig`, yang melempar `Error` bila bukan objek, punya kunci selain `apiBaseUrl`, atau nilainya melanggar aturan URL bersama;
  - `loadAppConfig(fetchFn: typeof fetch = fetch): Promise<AppConfig>`, yang memanggil `fetchFn('/config.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) })`, menolak status selain 2xx, lalu mem-parse JSON sebagai `unknown` dan memvalidasinya;
  - `startApp(deps)`, dengan `deps` berisi `root` (elemen `app-root` atau `null`), `fetchFn`, `bootstrap(providers)`, dan `logError`. Bila sukses, `bootstrap` dipanggil dengan provider `{ provide: APP_CONFIG, useValue: config }` ditambahkan ke `appConfig.providers`. Bila gagal, `bootstrap` tidak dipanggil, `root.textContent` diisi pesan AC-6, `role="alert"` dipasang, dan detail error dikirim ke `logError`.
- `main.ts` hanya memanggil `startApp` dengan `document.querySelector('app-root')`, `fetch`, `bootstrapApplication(App, ...)`, dan `console.error`.
- Semua isi `config.json` bersifat publik. Kunci baru hanya lewat spec dan tidak boleh berupa secret.
- Development memakai file default yang disajikan dev server (fitur 4); Profil A menulisnya dari `WEB_API_BASE_URL` saat deploy (fitur 30); Profil B menyajikannya dari `WEB_API_BASE_URL` lewat binary (fitur 31). Host yang mengembalikan `index.html` untuk file yang hilang tertangani sebagai "bukan JSON".

### `.env.example` dan git

Bagian backend `.env.example` (awal file) berisi tepat blok ini. Format komentar per variabel: `# <purpose>. <required|optional>, default <value|none|empty>, <secret|not secret>.`

```
# Backend configuration (spec 0002). Copy this file to .env for local development.
# Percent-encode $ # @ : / ? and spaces inside passwords in URLs.

# Runtime environment. required, default none, not secret.
APP_ENV=development
# Listener address, an IPv4 or IPv6 literal. optional, default 127.0.0.1, not secret.
APP_HOST=127.0.0.1
# Listener port. optional, default 3000, not secret.
APP_PORT=3000
# Runtime role URL, postgres://<user>:<password>@<host>:<port>/<database>?sslmode=<mode>. required, default none, secret.
DATABASE_URL=
# DATABASE_URL_FILE=
# Migrator role URL for the migration command, same shape as DATABASE_URL. optional, default none, secret.
DATABASE_MIGRATOR_URL=
# DATABASE_MIGRATOR_URL_FILE=
# Secure attribute on session cookies, false only for local http. optional, default true, not secret.
COOKIE_SECURE=false
# Extra origins allowed to call the API with credentials, comma separated. optional, default empty, not secret.
CORS_ALLOWED_ORIGINS=
# Allow the development seed. optional, default false, not secret.
DEV_SEED_ENABLED=false
# Public apiBaseUrl that deployment profiles write to config.json. optional, default /api, not secret.
WEB_API_BASE_URL=/api
```

- Spec 0003 dan 0004 menambah bagian mereka setelah blok ini, masing masing diawali baris `# --- <judul> (spec NNNN) ---`.
- Menyalin `.env.example` apa adanya sengaja menghasilkan `DATABASE_URL: is required` pada start pertama.
- `.gitignore` menambah `.env` dan `.env.*`, lalu `!.env.example`.

### Test

- Unit test Rust `#[cfg(test)]` di `config.rs`: semua baris tabel pesan, grammar URL, CORS, `_FILE`, aturan lingkungan, `Debug` teredaksi, vektor URL bersama, dan sinkronisasi `SCHEMA` dengan bagian backend `.env.example` lewat `include_str!("../../../.env.example")` (baca sampai baris pertama yang diawali `# --- `).
- Test proses Rust `apps/api/tests/config.rs` dengan helper `apps/api/tests/common/mod.rs`: setiap `Command` memakai `env_clear()` lalu env eksplisit; port bebas dari bind ke port `0`; tunggu dengan batas waktu dan `kill` agar server yang salah start tidak menggantung; test IPv6 dilewati bila `::1` tidak bisa di-bind. Mencakup status `78`, stdout kosong, header dan baris, override host dan port, penanda password di stdout dan stderr, dan `_FILE` dengan file sementara (`std::env::temp_dir`, dihapus oleh drop guard).
- `apps/api/tests/skeleton.rs` diubah: setiap proses (instance pertama dan kedua) memakai `env_clear()`, `APP_ENV=development`, dan `DATABASE_URL=postgres://app:placeholder@127.0.0.1:5432/app_test`. Test ini tetap satu satunya yang memakai port tetap `3000`, dan pesan `cannot bind 127.0.0.1:3000` tetap diharapkan.
- Komentar penanda test memakai `// covers: 0002 AC-n`.
- Vitest `apps/web/src/app/config/app-config.spec.ts`: vektor URL bersama, kunci asing, bukan objek, status non 2xx, JSON rusak, `fetchFn` dipanggil dengan `('/config.json', { cache: 'no-store', signal })`, `bootstrap` tidak dipanggil saat gagal, pesan dan `role="alert"`, nilai token saat sukses, dan dua isi `config.json` berbeda menghasilkan dua nilai berbeda. `fetch` disuntik sebagai parameter, bukan stub global.
- `scripts/env-example.test.ts` (bun): `git check-ignore --no-index -q` benar untuk `.env`, `.env.local`, `.env.production`, `apps/web/.env`, salah untuk `.env.example`; baris secret di `.env.example` kosong.
- Langkah baru di `scripts/clean-checkout.test.ts` setelah `build:web` (fitur 4 memindahkannya ke `tests/integration/`): build ulang web dengan env tambahan `DATABASE_URL` dan `DATABASE_MIGRATOR_URL` bernilai `postgres://canary:<uuid>@db.invalid/canary`, lalu pindai setiap file di `apps/web/dist` sebagai byte untuk uuid dan pola `postgres(ql)?://`. Pemindai diuji dulu pada file sementara yang memuat penanda agar tidak lulus kosong; `dist` harus tidak kosong. Ditambah: `dist/web/browser/config.json` sama dengan `{ "apiBaseUrl": "/api" }`, bundle utama memuat string `/config.json`, tidak ada file `environment*.ts` di antara file git di `apps/web`, kunci `fileReplacements` dan `define` tidak ada di `angular.json` (dicari rekursif), dan `process.env` tidak ada di `apps/web/src`.
- `childEnv()` dipindah ke `scripts/test-helpers.ts` dengan argumen `extraEnv`, dan selain `NODE_ENV` serta `GIT_*` juga menghapus `APP_*`, `DATABASE_*`, `COOKIE_SECURE`, `CORS_ALLOWED_ORIGINS`, `DEV_SEED_ENABLED`, `WEB_API_BASE_URL`, dan `*_FILE`, karena `bun test` memuat `.env` dan `.env.test` developer ke proses test.

**Data model sketch**: Tidak ada entitas persisten.

**API surface**:

| Permukaan | Isi | Akses | Kesalahan penting |
| --- | --- | --- | --- |
| Env backend | Tabel skema | Proses backend saat start | Status `78` dengan daftar masalah |
| `GET /config.json` | `{ "apiBaseUrl": string }` | Publik | Gagal atau tidak valid menghentikan bootstrap |

**Value sourcing**:

| Aksi | Nilai | Sumber |
| --- | --- | --- |
| Start backend | Lingkungan | `APP_ENV` |
| Bind | Host dan port | `APP_HOST`, `APP_PORT`, atau default |
| Validasi TLS database | Mode TLS | Parameter `sslmode` di URL database |
| Secret dari file | Isi secret | File di `<NAMA>_FILE` |
| Teks error | Pesan | Tabel pesan di spec ini |
| Bootstrap Angular | `apiBaseUrl` | `GET /config.json` saat runtime |
| `config.json` per profil | `apiBaseUrl` | `WEB_API_BASE_URL` (fitur 30 dan 31), default `/api` |
| Contoh `.env` lokal | Host, port, database, role | Bagian spec 0003 di `.env.example` |

**Key invariants**:

- Konfigurasi backend hanya dibaca saat start, dari env proses dan file `<NAMA>_FILE`.
- Tidak ada nilai secret di repo, log, pesan error, atau bundle Angular.
- Staging dan production tidak pernah berjalan dengan cookie tanpa Secure, origin CORS `http://`, seed development, URL frontend `http://`, atau database tanpa TLS.
- `config.json` hanya berisi kunci yang diizinkan spec, semuanya publik, dan tidak bisa mengarahkan frontend ke origin lain lewat path yang menipu.
- Test tidak bergantung pada `.env` developer.

**Security model**: Konfigurasi bukan permukaan pengguna. Ancaman yang ditangani: secret bocor ke log, terminal, atau bundle; salah konfigurasi production; secret masuk git; open redirect API lewat URL protocol relative. File `<NAMA>_FILE` dibaca dengan hak proses; izin file tanggung jawab orkestrator.

**Configuration required**: Semua variabel di tabel skema.

**Critical test scenarios**:

- Start sukses dengan nilai minimal, override host dan port, dan IPv6, memverifikasi **AC-2**.
- Start gagal dengan empat masalah sekaligus, status `78`, stdout kosong, urutan baris, memverifikasi **AC-1**.
- Matriks staging dan production untuk setiap nilai tidak aman, dengan kontrol development yang lulus, memverifikasi **AC-3**.
- Penanda password tidak muncul di keluaran; `_FILE` sukses, konflik, file hilang, kosong, besar, bukan UTF-8; `Debug` teredaksi, memverifikasi **AC-4**.
- Sinkronisasi skema dan `.env.example`, aturan git, memverifikasi **AC-5**.
- Vitest bootstrap dan validator dengan vektor bersama, memverifikasi **AC-6**.
- Pindaian bundle dan pemeriksaan statis, memverifikasi **AC-7**.

## Build plan

Tracer Bullet: jalur start backend nyata lebih dulu, lalu aturan, secret, dokumentasi, dan frontend.

1. `apps/api/src/config.rs` dengan skema, default, aturan umum, dan tabel pesan; sambungkan ke `main` dengan status `78`; ubah `skeleton.rs`, satisfies **AC-1**, **AC-2**.
2. Grammar URL database, CORS, aturan URL bersama, aturan lingkungan, `Secret`, dan `<NAMA>_FILE`, satisfies **AC-3**, **AC-4**.
3. `.env.example` bagian backend dan `.gitignore`, satisfies **AC-5**.
4. `config.json`, `app-config.ts`, dan `main.ts`, satisfies **AC-6**, **AC-7**.
5. Semua test di bagian Test, satisfies **AC-1** sampai **AC-7**.

## Consequences

**Positive**:

- Satu sumber konfigurasi di semua lingkungan.
- Salah konfigurasi berbahaya ditolak sebelum request pertama.
- Satu build Angular dapat dipromosikan antar lingkungan.

**Negative**:

- `cargo run` dan `bun run run:api` sebelum fitur 4 keluar `78` tanpa env; developer memakai task fitur 4 atau mengekspor env sendiri.
- `DATABASE_URL` wajib sejak fitur 3 walaupun koneksi baru dibuka fitur 6.
- Frontend butuh satu request tambahan sebelum bootstrap.
- Parser buatan sendiri harus dirawat; grammar URL bisa berbeda dari parser driver database.

**Neutral**:

- Variabel sesi, logging, dan keamanan HTTP ditambah fitur 10, 14, dan 26 dengan aturan yang sama.

## Follow-up

- [ ] Fitur 6 memastikan driver database membaca `sslmode` sama dengan validator ini (driver tertentu juga menerima alias `ssl-mode`).
- [ ] Fitur 10 menentukan apakah ringkasan konfigurasi tanpa secret dicetak saat start.
- [ ] Fitur 4 menyelaraskan task `run:api` dengan pemuatan `.env`.

## Rationale

Konteks, opsi yang dibandingkan, dan alasan ada di [rationale.md](rationale.md).
