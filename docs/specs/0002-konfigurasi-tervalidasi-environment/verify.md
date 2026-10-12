# Verify: Konfigurasi tervalidasi dan environment · spec 0002 · updated 2026-10-12

_Langkah diturunkan dari acceptance criteria dan tabel Value sourcing spec 0002. `/check verify` menjalankannya; `/test` mengunci yang tahan lama. Setiap perintah backend memakai `env -i` agar `.env` atau export shell tidak ikut terbaca, dan port bebas kecuali langkah port default._

## Commands

- [x] `cargo build --locked -p api`, lalu `env -i ./target/debug/api` → status `78`, stdout kosong, stderr tepat `configuration error:`, `  APP_ENV: is required`, `  DATABASE_URL: is required`, tanpa `panicked` → AC-1
- [x] `env -i APP_ENV=prod APP_PORT=0 CORS_ALLOWED_ORIGINS='*' ./target/debug/api` → status `78`, stdout kosong, empat baris berurutan `APP_ENV`, `APP_PORT`, `DATABASE_URL`, `CORS_ALLOWED_ORIGINS` dengan teks persis dari tabel pesan → AC-1
- [x] Pegang sebuah port dengan listener lain, jalankan `env -i APP_ENV=development APP_PORT=<port itu> DATABASE_URL=mysql://x@db/x ./target/debug/api` → status `78` (bukan panic `cannot bind`), jadi konfigurasi diperiksa sebelum listener dibuka → AC-1
- [x] Pastikan port 3000 bebas, `env -i APP_ENV=development DATABASE_URL=postgres://app:pw@127.0.0.1:5432/app ./target/debug/api` → baris `api listening on http://127.0.0.1:3000`; `curl -i http://127.0.0.1:3000/x` → `404` → AC-2
- [x] Tambah `APP_HOST=::1 APP_PORT=<port bebas>` → `api listening on http://[::1]:<port>`; `curl -g -i 'http://[::1]:<port>/x'` → `404` → AC-2
- [x] Jalankan instance kedua pada port yang sudah dipakai → status bukan nol, stderr memuat `cannot bind 127.0.0.1:<port>`, stdout kosong → AC-2
- [x] Untuk `APP_ENV=staging` lalu `production`: `COOKIE_SECURE=false`, `DEV_SEED_ENABLED=true`, `CORS_ALLOWED_ORIGINS=http://app.example.com`, `WEB_API_BASE_URL=http://api.example.com`, `DATABASE_URL` tanpa `sslmode`, `DATABASE_MIGRATOR_URL` dengan `sslmode=disable` → status `78` dengan enam baris aturan lingkungan berurutan → AC-3
- [x] Nilai yang sama dengan `APP_ENV=development` dan `APP_ENV=test` → server start dan mencetak baris listening → AC-3
- [x] `APP_ENV=production` dengan `sslmode=require`, `verify-ca`, dan `verify-full` pada kedua URL, cookie Secure, tanpa seed, origin `https://`, dan `WEB_API_BASE_URL=/api` → server start → AC-3
- [x] `CORS_ALLOWED_ORIGINS='*'` dengan `APP_ENV=development` → baris `CORS_ALLOWED_ORIGINS: * is not allowed` → AC-1, AC-3
- [x] Isi password `DATABASE_URL` dengan penanda unik; start sukses lalu hentikan, dan start gagal (URL rusak, `ssl-mode`, staging tanpa `sslmode`) → `grep` penanda di stdout dan stderr tidak menemukan apa pun → AC-4
- [x] `DATABASE_URL_FILE` menunjuk file sementara berisi URL valid diakhiri `\n` → server start; dengan `DATABASE_URL` juga diisi → `DATABASE_URL: set either DATABASE_URL or DATABASE_URL_FILE, not both` → AC-4
- [x] `DATABASE_URL_FILE` ke path yang tidak ada, file berisi `\n` saja, file 9000 byte, dan file berisi byte `0xff` → berturut turut `cannot read file "<path>"`, `file is empty`, `file is larger than 8 KiB`, `file is not valid UTF-8` pada baris `DATABASE_URL_FILE:`, tanpa isi file → AC-4
- [x] `cargo test --locked -p api secrets_are_redacted_in_debug_and_display` → lulus; `Debug` konfigurasi menampilkan `[redacted]` dua kali dan tidak memuat password → AC-4
- [x] Bandingkan `.env.example` dengan blok di spec 0002 (`diff`) → identik, secret kosong → AC-5
- [x] `git check-ignore --no-index -v .env .env.local .env.production apps/web/.env .env.example` → empat pertama cocok dengan `.env` atau `.env.*`, `.env.example` cocok dengan `!.env.example` (tidak diabaikan) → AC-5
- [x] Salin `.env.example` apa adanya ke environment proses dan jalankan backend → hanya `DATABASE_URL: is required` → AC-5
- [x] Ubah satu default di salinan `.env.example` (misalnya `default 3000` menjadi `default 3001`), jalankan `cargo test --locked -p api schema_matches` → gagal; kembalikan → lulus → AC-5
- [x] `bun run build:web` → `apps/web/dist/web/browser/config.json` berisi `{ "apiBaseUrl": "/api" }` dan bundle `main-*.js` memuat `/config.json` → AC-6
- [x] `DATABASE_URL=postgres://canary:<uuid>@db.invalid/canary DATABASE_MIGRATOR_URL=<sama> bun run build:web`, lalu `grep -rlaE '<uuid>|postgres(ql)?://' apps/web/dist` → tidak ada hasil → AC-7
- [x] `git ls-files apps/web | grep -E '/environment[^/]*\.ts$'`, cari kunci `fileReplacements` dan `define` di `apps/web/angular.json`, dan `grep -r process.env apps/web/src` → tidak ada temuan → AC-7

## UI / manual

- [x] Sajikan `apps/web/dist/web/browser` dengan server statis lokal, buka halaman → aplikasi bootstrap (judul `Hello, web` tampil), tab network menunjukkan satu `GET /config.json` dengan cache dilewati sebelum bundle merender → AC-6
- [x] Tanpa build ulang, ganti `config.json` di output build menjadi `{ "apiBaseUrl": "https://api.example.com" }` dan muat ulang → respons `/config.json` baru terbaca dan aplikasi tetap bootstrap → AC-6
- [x] Ganti `config.json` menjadi `{ "apiBaseUrl": "//evil.example" }`, lalu `{ "apiBaseUrl": "/api", "extra": 1 }`, lalu JSON rusak, lalu hapus filenya (404) → setiap kali aplikasi tidak bootstrap dan `app-root` menampilkan `Application configuration could not be loaded. Check /config.json and reload the page.` dengan `role="alert"`; console mencatat detail error → AC-6
- [x] Kembalikan `config.json` default → aplikasi bootstrap lagi → AC-6
- [x] Sajikan output build dengan server lokal yang menahan `/config.json` lebih dari 5 detik → tidak ada alert pada detik ketiga, alert muncul sekitar 5 detik setelah navigasi, dan console mencatat `TimeoutError` → AC-6

## Value sourcing

- [x] Start backend, lingkungan dari `APP_ENV`: langkah AC-3 di atas mengganti `APP_ENV` (development, test, staging, production, nilai salah) dan hasil berubah sesuai → AC-3
- [x] Bind, host dan port dari `APP_HOST`, `APP_PORT`, atau default: langkah AC-2 di atas (default, IPv4, IPv6) → AC-2
- [x] Validasi TLS database dari `sslmode`: langkah AC-3 di atas, termasuk `sslmode=REQUIRE` dan dua `sslmode` yang ditolak → AC-3
- [x] Secret dari file `<NAMA>_FILE`: langkah AC-4 di atas, nilai dari file dipakai dan `\n` di akhir dibuang → AC-4
- [x] Teks error dari tabel pesan spec: bandingkan stderr langkah AC-1 dan AC-3 kata demi kata dengan tabel pesan → AC-1
- [x] `apiBaseUrl` dari `GET /config.json` saat runtime: langkah UI di atas; nilai token per isi file dikunci oleh Vitest `app-config.spec.ts` (dua isi berbeda menghasilkan dua nilai) → AC-6
- [x] `config.json` per profil dari `WEB_API_BASE_URL`: penulisan file milik fitur 30 dan 31; di fitur ini cukup pastikan server menolak `WEB_API_BASE_URL=//evil.example` dengan pesan grammar dan `http://` pada production dengan pesan aturan lingkungan → AC-3
- [ ] Contoh `.env` lokal dari bagian spec 0003: milik fitur 5, di luar fitur ini

## Acceptance-criteria coverage

- AC-1 status `78`, header, baris per variabel, urutan skema, wildcard · AC-2 default `127.0.0.1:3000`, override host dan port, IPv6 dalam kurung siku, `cannot bind` · AC-3 matriks staging dan production dengan kontrol development dan test · AC-4 penanda password, `Debug` teredaksi, `<NAMA>_FILE` · AC-5 `.env.example` sama dengan spec, aturan git, sinkronisasi skema · AC-6 `config.json` runtime, ganti tanpa build ulang, alert saat gagal · AC-7 pindaian bundle dan pemeriksaan statis

## Catatan tafsiran

Bagian spec yang diam dibangun dengan bacaan paling harfiah dan ketat, lalu dikunci test. Bila Anda ingin mengubah salah satunya, ubah lewat spec (`/architect`), bukan diam diam di kode.

- Port (`APP_PORT`, port URL database, port origin CORS) hanya digit ASCII, tanpa tanda `+` atau `-`.
- "Spasi" dibaca sebagai whitespace Unicode (`char::is_whitespace`), sama di Rust dan TypeScript; kedua test memakai daftar code point yang sama.
- Query URL database: setiap item berbentuk `k=v` dengan kunci tidak kosong; nilai boleh kosong; `?` kosong dan `&` di akhir ditolak; larangan karakter mentah berlaku untuk kunci dan nilai.
- Batas 8 KiB `<NAMA>_FILE` dihitung dari byte mentah sebelum satu baris baru dibuang.
- Nilai `<NAMA>_FILE` yang bukan UTF-8 dilaporkan pada baris `<NAMA>_FILE: must be valid UTF-8`.
- `Config` tidak menyimpan `APP_ENV`; nilainya hanya dipakai saat validasi. Fitur yang butuh `APP_ENV` menambah field di `Config`, bukan membaca env lagi.
- Aturan URL bersama hanya memeriksa yang disebut spec, jadi port pada bentuk URL tidak divalidasi.
- `startApp` mencatat kegagalan bootstrap ke `logError` tanpa alert konfigurasi, sama dengan `catch` di `main.ts` lama.
