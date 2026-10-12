# 0002. Rationale: konfigurasi tervalidasi dan environment

Catatan keputusan untuk [spec 0002](index.md). Bagian ini tidak dibaca `/develop` saat membangun.

## Context

Backend Axum di `apps/api` saat ini bind ke alamat yang ditulis langsung di kode (spec 0001) dan belum punya konfigurasi. Brief bagian 9 meminta skema konfigurasi lengkap (nama, tujuan, wajib atau opsional, default aman, secret atau bukan, validasi, kebutuhan restart), precedence, pemisahan development, test, staging, dan production, fail fast, `.env.example` tanpa secret, serta pemeriksaan salah konfigurasi production. Untuk frontend, brief membedakan konfigurasi saat build dan saat runtime, menegaskan semua yang dikirim ke browser bersifat publik, dan meminta API base URL untuk kedua profil deployment.

Konfigurasi ini menjadi kontrak bersama: fitur 4 menjalankan backend dan proxy dengan nilai dari sini, fitur 5 menyediakan database yang URL-nya diisi ke sini, fitur 6 membuka koneksi dengan nilai ini, dan fitur 14, 17, 26, 30, serta 31 memakai variabel keamanan dan frontend yang didefinisikan sekarang. Variabel yang baru dipakai fitur berikutnya tetap harus ada sejak awal, karena scope meminta mode production menolak cookie tanpa Secure, CORS wildcard, dan seed development sejak fitur ini.

Gayanya mengikuti spec 0001: alat sedikit, pin tepat, tanpa teknologi baru di luar spec. Mesin development menjalankan task lewat Bun, yang ternyata memuat `.env` hanya untuk script yang dijalankan langsung (diperiksa 2026-10-12 dengan Bun 1.4.3), bukan untuk `bun run <nama>`. Perilaku tersembunyi ini memengaruhi cara development memuat secret lokal.

## Options considered

### Option 1: Env proses saja, parser sendiri, `<NAMA>_FILE`, `config.json` runtime

Backend hanya membaca env, divalidasi oleh modul kecil tanpa crate tambahan. Secret boleh lewat file. Development memuat `.env` lewat task Bun. Frontend mengambil `config.json` publik saat runtime.

**Pros**:

- Satu sumber nilai di semua lingkungan; cocok dengan container dan secret Compose.
- Pesan error dan redaksi secret sepenuhnya terkendali.
- Satu build frontend untuk semua lingkungan.

**Cons**:

- `cargo run` langsung tidak membaca `.env`.
- Parser harus dirawat sendiri.
- Frontend butuh request tambahan sebelum bootstrap.

### Option 2: Rust memuat `.env` sendiri (crate dotenvy)

Backend membaca `.env` saat development, lalu env proses menimpanya.

**Pros**:

- `cargo run` dan IDE langsung mendapat nilai lokal.

**Cons**:

- Dua jalur pemuatan (Bun dan Rust) dengan aturan berbeda.
- Risiko `.env` terbaca di lingkungan yang salah bila penjaganya keliru.
- Menambah dependency.

### Option 3: File TOML per lingkungan ditimpa env (crate figment)

`config/development.toml` dan seterusnya di repo, ditimpa env.

**Pros**:

- Nilai bukan secret per lingkungan terlihat dan ter-review di repo.

**Cons**:

- Dua sumber yang harus dibaca bersamaan untuk tahu nilai efektif.
- Nilai staging dan production di repo mendorong kebocoran detail infrastruktur.
- Menambah dependency yang lebih berat dari kebutuhan.

### Option 4: Konfigurasi frontend saat build

Nilai ditanam saat `ng build` per configuration.

**Pros**:

- Tidak ada request tambahan.

**Cons**:

- Build ulang per lingkungan, bertentangan dengan artefak immutable yang dipromosikan (brief bagian 13).

## Rationale

Option 1 dipilih karena tiga kekuatan di Context. Pertama, staging dan production memakai container, yang secara alami menyuplai env dan file secret, jadi env proses adalah kontrak yang paling sedikit berubah antar lingkungan. Kedua, risiko terbesar fitur ini adalah kebocoran secret, dan parser sendiri yang kecil membuat aturan "pesan tidak pernah menyalin nilai" bisa ditegakkan dan diuji tanpa bergantung pada format error crate lain. Ketiga, brief meminta artefak yang dibangun sekali lalu dipromosikan, yang hanya mungkin bila konfigurasi frontend dibaca saat runtime.

Varian `<NAMA>_FILE` dipilih (atas pilihan pengguna) karena Docker dan Compose secrets mengirim secret sebagai file, sehingga secret tidak tampil di `docker inspect` atau env proses. Larangan mengisi keduanya mencegah dua sumber yang saling bertentangan.

Parameter `sslmode` menjadi aturan staging dan production karena brief bagian 9 meminta TLS untuk koneksi database dan Profil A memakai PostgreSQL eksternal. Default `COOKIE_SECURE=true` dipilih agar lupa mengisi variabel menghasilkan perilaku aman; development yang memakai `http://localhost` menyetelnya `false` lewat `.env`. Wildcard CORS ditolak di semua lingkungan, lebih ketat dari scope, karena browser tidak mengizinkan wildcard bersama credential sehingga nilainya tidak pernah berguna untuk aplikasi berbasis cookie.

Status keluar `78` (EX_CONFIG dari konvensi sysexits) dipilih agar orkestrator dan script dapat membedakan salah konfigurasi dari crash (`101` untuk panic Rust).
