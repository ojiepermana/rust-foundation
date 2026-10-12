# Review, feat/fitur-3-konfigurasi (fitur 3, spec 0002), 2026-10-12

**Reviewed by**: sonnet (author on opus)
**Scope**: 17 files, branch `feat/fitur-3-konfigurasi` vs `main` (merge base `9fab813`, 3 commit, tanpa perubahan yang belum di-commit)
**Verdict**: Approve with nits

## Summary

Perubahan ini mengimplementasikan fitur 3 sesuai spec 0002: `apps/api/src/config.rs` (pemuat murni `Config::load(read_var, read_file)`, tabel pesan, grammar URL database, grammar origin CORS, aturan URL bersama, `Secret` teredaksi, semantik `<NAMA>_FILE`), `main.rs` yang memuat konfigurasi sebelum listener dibuka dan keluar `78` lewat `writeln!`, `.env.example` plus `.gitignore`, `config.json` runtime dan `startApp` di Angular, serta test di empat lapisan (unit Rust, proses Rust, Vitest, bun). Saya membaca setiap file yang berubah penuh, membandingkannya baris demi baris dengan Requirements AC-1 sampai AC-7, tabel pesan, urutan pemeriksaan umum, dan bagian Test spec. Saya tidak menemukan blocker maupun major: kodenya sesuai kontrak spec, tidak ada nilai yang disalin ke pesan error, dan tidak ada dependency baru (`Cargo.toml`, `Cargo.lock`, `package.json`, `bun.lock` tidak berubah). Temuannya tiga minor (pembacaan file `_FILE` tanpa batas sebelum cek 8 KiB, URL yang salah ditaruh di `<NAMA>_FILE` tercetak utuh termasuk password, dan paritas aturan whitespace Rust dan TypeScript yang hanya diuji sampai ASCII dan NBSP) serta beberapa nit.

Bukti yang saya kumpulkan sendiri: `cargo test --locked -p api --bin api` (31 lulus), `cargo clippy --locked --workspace --all-targets -- -D warnings` bersih, `diff` antara blok di spec 0002 dan `.env.example` identik, dan beberapa percobaan manual dengan binary asli di bawah `env -i` (lihat Minor 2 dan bagian penilaian keputusan). Gerbang yang dijalankan author (`bun run check`, `test:scripts` 95, `test:web` 53, `cargo test` 44) tidak saya ulang kecuali yang disebut tadi.

## Minor

### 🟡 File `<NAMA>_FILE` dibaca utuh ke memori sebelum batas 8 KiB diperiksa, `apps/api/src/main.rs:19`

**Problem**: closure `read_file` memakai `std::fs::read(path)`, jadi seluruh isi file masuk ke `Vec<u8>` lebih dulu, baru `read_secret_file` (`apps/api/src/config.rs:392`) membandingkan `bytes.len()` dengan `MAX_SECRET_FILE_BYTES`. Batas 8 KiB di spec ("dibaca sebagai byte, maksimal 8 KiB") hanya menjadi penolak setelah fakta. Path yang menunjuk `/dev/zero`, FIFO tanpa penulis, atau file sangat besar membuat start menggantung atau menghabiskan memori, bukan gagal cepat dengan `file is larger than 8 KiB`.
**Why it matters**: tujuan fitur ini adalah gagal cepat dengan daftar masalah sebelum listener dibuka. Salah konfigurasi orkestrator (path ke device atau pipe) lebih mungkin menghasilkan start yang menggantung tanpa keluaran daripada pesan yang menyebut variabelnya. Risikonya kecil karena path dipilih operator, dan spec memang menyebut `std::fs::read` di bagian Implementasi backend, jadi ini bukan penyimpangan author.
**Suggested fix**: ganti closure di `main` dengan pembaca terbatas, misalnya buka file lalu `take(MAX + 1)` dan `read_to_end`, tetap dengan tanda tangan `Fn(&Path) -> io::Result<Vec<u8>>` sehingga `Config::load` dan semua test tidak berubah; hasil `MAX + 1` byte tetap memicu pesan `file is larger than 8 KiB`. Bila spec dianggap mengikat pada `std::fs::read`, catat pembacaan terbatas sebagai penyempurnaan di spec.

### 🟡 URL yang salah diisi ke `<NAMA>_FILE` tercetak utuh, termasuk password, `apps/api/src/config.rs:389`

**Problem**: pesan `cannot read file "<path>"` menyalin nilai `<NAMA>_FILE` apa adanya, sesuai tabel pesan. Bila operator keliru mengisi URL-nya langsung ke variabel `_FILE` (kesalahan yang mudah terjadi karena nama variabelnya hampir sama dengan `DATABASE_URL`), password ikut tercetak. Saya mereproduksinya: `env -i APP_ENV=development DATABASE_URL_FILE='postgres://app:s3cretpw@db/app' ./target/debug/api` mencetak `DATABASE_URL_FILE: cannot read file "postgres://app:s3cretpw@db/app"` ke stderr.
**Why it matters**: key invariant spec ("tidak ada nilai secret di ... log, pesan error") dan AC-4 melarang nilai `DATABASE_URL` muncul di stderr "baik saat nilainya tidak valid". Kasus ini ada di celah antara kalimat spec "path bukan secret" dan kenyataan bahwa isi variabel `_FILE` ditentukan operator. Implementasinya mengikuti spec secara harfiah, jadi ini celah spec, bukan cacat kode; log stderr biasanya masuk agregator log.
**Suggested fix**: putuskan lewat spec (bukan diam diam di kode): misalnya jangan cetak path bila memuat `://` atau `@` (pesan tanpa path, atau path diganti `[redacted]`), dan tambahkan satu test yang mengisi URL ke `DATABASE_URL_FILE`. Bila keputusannya tetap mencetak apa adanya, catat risikonya di bagian Security model spec dan tambahkan satu kalimat di `.env.example`.

### 🟡 Paritas aturan whitespace Rust dan TypeScript tidak diuji di luar ASCII dan NBSP, `apps/web/src/app/config/app-config.ts:21`

**Problem**: aturan URL bersama harus identik di `is_valid_base_url` (`apps/api/src/config.rs:623`, memakai `char::is_whitespace` dan `char::is_control`) dan `isValidBaseUrl` (TypeScript, memakai tabel rentang tulisan tangan `isSpaceOrControl`). Saya memeriksa tabelnya terhadap properti Unicode `White_Space` dan kategori `Cc` dan hasilnya sama persis (0x00 sampai 0x20, 0x7F sampai 0xA0, 0x1680, 0x2000 sampai 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000), jadi saat ini tidak ada bug. Tetapi vektor bersama dari spec hanya memuat spasi ASCII, dan test tambahan hanya menyentuh `\t`, spasi, NUL (TypeScript, `app-config.spec.ts:71`) serta `\t`, NBSP, NUL (Rust, `config.rs:1315`). Karakter seperti U+0085, U+2028, U+3000 atau U+007F tidak diuji di sisi mana pun, begitu pula batas yang sengaja tidak termasuk (U+200B, U+FEFF).
**Why it matters**: tabel rentang tulisan tangan adalah jenis kode yang pelan pelan menyimpang (misalnya ketika Unicode menambah karakter spasi), dan penyimpangan itu justru yang dikeluhkan spec: server menolak satu nilai yang diterima frontend atau sebaliknya. Test saat ini tidak akan menangkapnya.
**Suggested fix**: tambahkan satu daftar vektor non-ASCII yang sama di kedua test (tidak valid: `/api `, `/api\u0085`, `/api `, `/api　`, `/api\u007f`; valid: `/api​`, `/api﻿`), dengan komentar bahwa daftar itu ditambahkan author sebagai perluasan dari vektor spec.

## Nits

- ⚪ `apps/web/src/app/config/app-config.ts:113`, `role="alert"` dipasang pada elemen yang sama dengan pengisian `textContent` dalam satu tugas sinkron. Sebagian pembaca layar hanya mengumumkan live region yang sudah ada sebelum isinya berubah; pasang `role` lebih dulu (atau pertimbangkan `aria-live="assertive"` di `index.html`) dan cek dengan pembaca layar. Verifikasi manual di `verify.md` hanya memeriksa atribut, bukan pengumumannya.
- ⚪ `apps/web/src/app/config/app-config.ts:94`, `StartAppDeps` tidak diekspor padahal dipakai di tanda tangan `startApp` yang diekspor; ekspor agar pemanggil dan test dapat memakai nama tipenya.
- ⚪ `apps/api/src/config.rs:356`, nilai `<NAMA>_FILE` yang bukan UTF-8 dilaporkan pada baris `<NAMA>_FILE:` dengan teks `must be valid UTF-8`. Tabel pesan spec ambigu (baris "env bukan UTF-8" berlaku untuk "semua" dengan awalan `<NAMA>: `, sedangkan baris `*_FILE` memakai `<NAMA>_FILE: `); pilihan author masuk akal dan terkunci oleh test, tetapi catat pilihannya di spec atau `verify.md` supaya tidak ditafsir ulang diam diam.
- ⚪ `apps/api/src/config.rs:172`, `Config` tidak menyimpan `APP_ENV` setelah validasi. Konsisten dengan spec (daftar `#[allow(dead_code)]` tidak menyebut pemakai `APP_ENV`), tetapi fitur 10, 14, dan 17 hampir pasti membutuhkannya; saat itu tambahkan field `app_env` ke `Config`, jangan membaca ulang env di luar `Config::load`.
- ⚪ `apps/api/src/config.rs:339`, `Loader::source` adalah satu `match` dengan guard dan nama yang di-shadow (`(direct, from_file) if is_set(...)`); urutannya benar dan terkunci test, tetapi urutan arm adalah logikanya. Satu komentar singkat per arm ("rule 1: conflict", "rule 2: not UTF-8", dan seterusnya) atau pemecahan menjadi dua fungsi akan memudahkan pembaca berikutnya menambah variabel `_FILE` baru.
- ⚪ `scripts/clean-checkout.test.ts:161`, test "the web build reads config.json at runtime" membaca `dist` yang dibuat oleh test sebelumnya; dijalankan sendiri (`-t`) test itu gagal dengan `ENOENT`, bukan pesan yang jelas. Sama dengan pola test lain di file ini, jadi cukup satu komentar yang menyebut ketergantungan urutannya.
- ⚪ `apps/api/AGENTS.md:5`, `apps/api/AGENTS.md:31`, `apps/web/AGENTS.md:9`, konteks agent sekarang usang: Overview api masih menyebut "alamat sementara ... tanpa konfigurasi", Gotchas masih menyebut "Port 3000 tetap sampai fitur 3", dan Key files di kedua file belum memuat `config.rs`, `tests/config.rs`, `tests/common/mod.rs`, `app/config/app-config.ts`, dan `public/config.json`. Itu pekerjaan `/sync` yang masih tersisa di scope, jadi cukup dipastikan dijalankan sebelum merge.

## Strengths

- `Config::load(read_var, read_file)` murni dan menerima pembaca env serta file lewat parameter, sehingga seluruh tabel pesan, grammar, aturan lingkungan, dan semua kasus `_FILE` diuji sebagai unit tanpa menyentuh environment proses. Helper `Fixture::errors()` juga menegaskan di setiap pemanggilan bahwa tidak ada baris yang memuat penanda password, jadi "tidak menyalin nilai" diuji di ratusan kasus, bukan di satu tempat.
- Urutan pemeriksaan umum spec (sumber, UTF-8, kosong, whitespace, grammar, aturan lingkungan, dengan aturan lingkungan dilewati bila `APP_ENV` hilang atau salah) diimplementasikan persis dan dikunci test yang tepat (`the_first_failing_rule_is_the_only_line_for_a_variable`, `environment_rules_are_skipped_when_app_env_is_missing_or_invalid`). Saya menelusuri kombinasi non-UTF-8, kosong, dan konflik pada `<NAMA>` dan `<NAMA>_FILE` secara manual dan semuanya cocok dengan spec.
- Test proses Rust dirancang defensif: `env_clear()` di setiap `Command`, port dari bind ke `0`, batas waktu dengan `kill`, drop guard untuk proses dan file sementara, test IPv6 yang dilewati bila `::1` tidak bisa di-bind, dan test stderr tertutup yang benar benar membuktikan alasan memakai `writeln!` bukan `eprintln!`. `skeleton.rs` tetap satu satunya test yang memakai port `3000`.
- Frontend memisahkan efek dari logika dengan `startApp(deps)` (fetch, bootstrap, dan log disuntik), sehingga alur gagal dan sukses diuji tanpa stub global; test `__proto__` dan test "dua isi `config.json` menghasilkan dua nilai token" menutup dua risiko yang mudah terlewat. Pesan alert memakai `textContent`, jadi tidak ada jalur XSS dari isi `config.json`.
- Pemindai bundle di `clean-checkout.test.ts` diuji dulu pada file sementara yang memuat penanda (termasuk byte biner dan skema `postgresql://`), sehingga hasil "bersih" tidak bisa lulus kosong; `childEnv()` mencegah `.env` developer yang dimuat `bun test` bocor ke proses anak, persis seperti yang diminta spec.
- `.env.example` identik dengan blok di spec (saya `diff` sendiri) dan dijaga test sinkronisasi terhadap `SCHEMA` yang memeriksa urutan, wajib atau opsional, default, status secret, nilai secret kosong, dan baris `_FILE`.

## Test coverage

`TESTS = configured`. Logika baru tercakup baik: 31 unit test di `config.rs` (semua baris tabel pesan, grammar URL dengan 40 lebih vektor tolak, CORS, `sslmode`, `_FILE`, aturan lingkungan, `Debug` teredaksi, sinkronisasi `.env.example`), 12 test proses di `apps/api/tests/config.rs` (status `78`, stdout kosong, urutan baris, bind, IPv6, `cannot bind`, matriks staging dan production, penanda password, `_FILE`, stderr tertutup, env bukan UTF-8), `app-config.spec.ts` (vektor bersama, kunci asing, non-objek, status non-2xx, JSON rusak, argumen `fetch`, alert dan `role`, dua nilai token), `env-example.test.ts` (aturan git dan `childEnv`), dan tiga langkah baru di `clean-checkout.test.ts` untuk AC-6 dan AC-7. Setiap test memakai penanda `// covers: 0002 AC-n`.

Celah yang tersisa, semuanya kecil: paritas Unicode di luar ASCII untuk aturan URL bersama (Minor 3); `_FILE` yang bukan UTF-8 dan `APP_HOST` yang salah hanya diuji di level unit, tidak di level proses (cukup, karena jalur kodenya sama); tidak ada test yang membuktikan batas waktu 5 detik benar benar menghentikan `fetch` yang menggantung (hanya argumen `AbortSignal.timeout(5000)` yang diperiksa, sisanya dicakup langkah manual di `verify.md`); dan tidak ada test untuk pembacaan file tanpa batas (Minor 1).

## Penilaian keputusan "pembacaan paling ketat" author

Saya menilai setiap keputusan terhadap teks spec. Tidak ada yang bertentangan dengan spec.

1. **`APP_PORT` dan port URL hanya digit ASCII, tanpa tanda**: konsisten dengan "bilangan bulat `1` sampai `65535`" dan dengan pesan `must be an integer from 1 to 65535`; `+80` diterima `str::parse` tetapi ditolak di sini, yang lebih aman. Efek sampingnya angka nol di depan diterima (`APP_PORT=0080` menjadi `80`), tidak melanggar spec.
2. **"Spasi" sebagai whitespace Unicode**: aturan umum nomor 4 secara eksplisit menyebut `char::is_whitespace`, jadi konsisten; untuk "spasi mentah" di URL database dan aturan URL bersama, bacaan yang sama dipakai di kedua bahasa dan paritasnya benar (lihat Minor 3 untuk celah pengujian).
3. **Item query harus `k=v` dengan kunci tidak kosong, nilai boleh kosong**: konsisten dengan `?k=v&k=v`. Spec diam untuk `?` kosong dan `&` di akhir; ditolak, yang sejalan dengan sintaks parameter libpq.
4. **Batasan karakter mentah juga berlaku untuk kunci query**: spec hanya menyebut "nilai query", tetapi juga "kunci di-decode untuk dibandingkan", dan decode butuh escape `%XX` yang valid; tidak ada nilai praktis yang hilang. Konsisten.
5. **Batas 8 KiB menghitung byte mentah sebelum newline dibuang**: konsisten dengan urutan spec (baca byte, maksimal 8 KiB, lalu buang satu baris baru). File 8192 byte plus `\n` ditolak.
6. **`<NAMA>_FILE` bukan UTF-8 dilaporkan pada baris `<NAMA>_FILE`**: spec ambigu, pilihan author defensible; lihat nit di `config.rs:356`.
7. **`Config` tanpa field `app_env`**: konsisten dengan spec (tidak ada pemakai `APP_ENV` di daftar `#[allow(dead_code)]`); lihat nit di `config.rs:172`.
8. **Aturan URL bersama tidak memvalidasi port**: konsisten, spec hanya menyebut host tidak kosong, tanpa userinfo, query, fragment, atau garis miring akhir. Konsekuensinya `https://api.example.com:notaport` diterima (saya jalankan, dan memang tidak ada baris error); itu perilaku spec dan sama di TypeScript.
9. **`startApp` mencatat kegagalan bootstrap tanpa alert konfigurasi**: spec hanya mendefinisikan alert untuk kegagalan pemuatan konfigurasi, dan teks "configuration could not be loaded" akan menyesatkan untuk kegagalan bootstrap; mempertahankan perilaku `catch` lama di `main.ts` adalah pilihan yang benar.

## Tindak lanjut (author, setelah review)

- Minor 3 diperbaiki: kedua test kini memakai daftar code point yang sama (18 yang ditolak, 5 yang diterima, termasuk U+0085, U+2028, U+3000, U+007F, U+200B, U+FEFF). Test Rust `whitespace_and_control_characters_match_the_frontend_rule`, Vitest `rejects/accepts code point %i inside apiBaseUrl`. Karakter tak terlihat yang tertulis literal di `app-config.spec.ts` juga diganti `String.fromCodePoint`.
- Nit `role="alert"`: `role` kini dipasang sebelum teks.
- Nit `Loader::source`: setiap arm diberi komentar nomor aturan.
- Nit urutan test di `clean-checkout.test.ts`: diberi komentar ketergantungan.
- Nit tafsiran `<NAMA>_FILE` bukan UTF-8 dan `app_env`: dicatat di bagian Catatan tafsiran `verify.md`.
- Minor 1 (pembacaan `_FILE` tanpa batas) dan Minor 2 (URL di `<NAMA>_FILE` tercetak): tidak diubah, karena spec menyebut `std::fs::read` dan "path apa adanya" secara eksplisit. Keduanya dilaporkan sebagai keputusan yang perlu diambil lewat `/architect`.
- Nit `StartAppDeps` tidak diekspor: tidak diubah, karena spec menyebut daftar ekspor `app-config.ts`.
- Nit `AGENTS.md` usang: milik `/sync` setelah merge.
