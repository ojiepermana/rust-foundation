# Scope: Foundation Rust

Foundation Rust adalah starterkit aplikasi web untuk tim kecil sampai menengah: frontend Angular 22 atau lebih baru, backend Rust stable dengan Axum dan Tokio, PostgreSQL dengan migration berversi, kontrak OpenAPI dengan client Angular yang dihasilkan otomatis, modular monolith, dan dua profil deployment. Scope ini mengubah brief pada [docs/foundation.md](../foundation.md) menjadi fitur kecil dengan hasil yang dapat dibuktikan, dibagi ke delapan bagian.

**Build approach:** Tracer Bullet (membuktikan satu alur nyata lintas lapisan terlebih dahulu, lalu mempertebalnya satu segmen demi satu).
**Workflow:** GA (sesudah `/develop`: verifikasi melalui `/check verify`, pengujian melalui `/test`, review independen oleh model berbeda melalui `/check review`, lalu dokumentasi perubahan melalui `/document`). Ini tingkat ketelitian default proyek. `/architect` adalah langkah pertama yang disarankan untuk fitur dengan keputusan nyata, tetapi boleh Anda lewati bila sudah tahu cara membangunnya. Fitur tertentu boleh membawa tag sendiri (misalnya `· Beta`) untuk proses yang lebih ringan.

_Ini rekomendasi agar build Anda tertib, bukan keharusan. Lewati yang tidak cocok: bila Anda sudah tahu cara membangun sebuah fitur, pakai `/develop` dan lewati `/architect`. Anda yang memutuskan kapan sebuah fitur `done`._

## Batas dan keputusan

Scope ini mencakup fondasi wajib (bagian 1 sampai 4, 6, 7, dan 8), satu fitur demonstrasi (bagian 5, slice `projects`), dan daftar ekstensi yang ditunda. Scope tidak memilih pustaka, generator, provider CI, atau versi dependency; setiap pilihan itu dibuat di spec fitur pemiliknya. Dalam penyusunan scope tidak ada scaffold, instalasi, container, migration, atau perintah build yang dijalankan.

Brief meminta audit, matriks kompatibilitas, decision log, ADR, threat model, skema konfigurasi, matriks test, dan traceability. Dalam workflow ini semua itu hidup di spec per fitur (`docs/specs/`), bukan di satu dokumen rencana besar: fitur 1 menghasilkan audit dan ADR payung, fitur 26 menghasilkan threat model, dan seterusnya. Milestone M0 sampai M8 pada brief dipetakan ke kolom fase pada tabel ringkasan.

### Asumsi sementara dan pertanyaan prioritas

Scope memakai baseline dari brief bagian 4. Pertanyaan di bawah tidak memblokir perencanaan, tetapi jawabannya dapat mengubah spec fitur yang disebut. Jawab saat Anda menjalankan `/architect` fitur terkait.

| Pertanyaan | Asumsi sementara | Fitur yang bergantung |
| --- | --- | --- |
| Siapa pengguna dan jenis aplikasinya? | Aplikasi bisnis internal berbasis browser, semua halaman di balik login, tanpa halaman publik | 15, 16, dan penundaan SSR |
| Single tenant atau multi tenant? | Single tenant | 7, 19, 22, 23 |
| Model autentikasi? | Auth lokal dengan session sisi server dan cookie HttpOnly; tanpa registrasi publik; tanpa OIDC | 14, 17, 18, 25, 26, 29 |
| Butuh SSR atau SEO? | Tidak; Angular CSR saja | 15, 16, 31 |
| Target deployment dan profil default? | Container pada satu staging dan satu production; rekomendasi default Profil A dengan `/api` same origin lewat reverse proxy; Profil B tetap diverifikasi | 29, 30, 31, 32 |
| Skala dan beban? | Kecil sampai menengah, satu instance API dengan kemungkinan beberapa replika; angka kapasitas diukur, bukan diasumsikan | 6, 9, 28, 34 |
| Butuh email? | Tidak ada transport email pada baseline; pemulihan akun lewat admin | 25 dan penundaan registrasi, verifikasi, serta reset via email |
| Layanan eksternal yang tersedia? | Tidak ada yang diasumsikan (tanpa IdP, object storage, atau SaaS monitoring); exporter observability dan pelaporan error frontend diputuskan di spec | 10, 27, 32, 34 |

Bila Anda memilih multi tenant, OIDC, SSR, atau email otomatis, fitur yang disebut perlu spec ulang sebelum dibangun; fitur lain tidak berubah.

### Keputusan scope

- Registrasi publik: tidak ada; admin membuat pengguna (fitur 17 dan 20).
- Verifikasi email dan reset password via email: ditunda sampai transport email diputuskan.
- Reset password: jalur admin tanpa email (fitur 25).
- MFA: ditunda, dengan titik ekstensi di alur login (fitur 18).
- Audit trail: ya, untuk event keamanan dan aksi admin (fitur 21).
- Pagination: ya; kebijakannya di kontrak (fitur 11) dan dipakai fitur 20 dan 22.
- Soft delete: tidak pada baseline; hard delete dengan audit event; kolom status atau waktu hapus menjadi titik ekstensi pada model data (fitur 7).
- Upload file: ditunda.

### Non goal awal

Microservices, Kubernetes, NATS atau Kafka, Redis, billing, multi tenancy, workflow engine, event sourcing, dan ekstraksi modul menjadi service bukan bagian scope ini. Jalur ekstraksi satu modul didokumentasikan di spec fitur 8 beserta biayanya, bukan dibangun. Salah satu di atas masuk scope hanya dengan bukti kebutuhan terukur dan fitur tambahan yang dicatat lewat `/scope`.

## Ringkasan

| # | Fitur | Fase | Status |
| --- | --- | --- | --- |
| 1 | [Stack, audit, dan scaffold workspace](<001 - Workspace.md>) | Fondasi (M0, M1) | done |
| 2 | [Standar koding dan tooling](<001 - Workspace.md>) | Fondasi (M0, M1) | in-progress |
| 3 | [Konfigurasi tervalidasi dan environment](<001 - Workspace.md>) | Fondasi (M0, M1) | planned |
| 4 | [Task root dan lifecycle development](<001 - Workspace.md>) | Fondasi (M0, M1) | planned |
| 5 | [Infrastruktur PostgreSQL development](<001 - Workspace.md>) | Fondasi (M0, M1) | planned |
| 6 | [Akses data dan tooling migration](<002 - Backend.md>) | Fondasi backend (M2) | planned |
| 7 | [Model data inti](<002 - Backend.md>) | Fondasi backend (M2) | planned |
| 8 | [Kerangka aplikasi Axum dan batas modul](<002 - Backend.md>) | Fondasi backend (M2) | planned |
| 9 | [Health check dan graceful shutdown](<002 - Backend.md>) | Fondasi backend (M2) | planned |
| 10 | [Observability dasar](<002 - Backend.md>) | Fondasi backend (M2) | planned |
| 11 | [Sumber kebenaran OpenAPI dan kebijakan kontrak](<003 - Kontrak API.md>) | Kontrak (M3) | planned |
| 12 | [Generator client Angular](<003 - Kontrak API.md>) | Kontrak (M3) | planned |
| 13 | [Endpoint pertama lewat kontrak dan gate drift](<003 - Kontrak API.md>) | Kontrak (M3) | planned |
| 14 | [Model autentikasi dan sesi](<004 - Alur awal.md>) | Alur awal (M4) | planned |
| 15 | [Design system dan fondasi UI](<004 - Alur awal.md>) | Alur awal (M4) | planned |
| 16 | [App shell, routing, dan pola state](<004 - Alur awal.md>) | Alur awal (M4) | planned |
| 17 | [Seed development dan bootstrap admin](<004 - Alur awal.md>) | Alur awal (M4) | planned |
| 18 | [Login, logout, dan pengguna saat ini](<004 - Alur awal.md>) | Alur awal (M4) | planned |
| 19 | [Model role dan permission](<004 - Alur awal.md>) | Alur awal (M4) | planned |
| 20 | [Administrasi akses pengguna](<004 - Alur awal.md>) | Alur awal (M4) | planned |
| 21 | [Audit event keamanan](<004 - Alur awal.md>) | Alur awal (M4) | planned |
| 22 | [Daftar dan detail projects](<005 - Projects.md>) | Slice contoh (M5) | planned |
| 23 | [Buat, ubah, dan hapus project dengan kepemilikan](<005 - Projects.md>) | Slice contoh (M5) | planned |
| 24 | [Skenario negatif dan E2E utama](<005 - Projects.md>) | Slice contoh (M5) | planned |
| 25 | [Pemulihan akun tanpa email](<006 - Keamanan.md>) | Pembuktian (M6) | planned |
| 26 | [Hardening keamanan HTTP dan threat model](<006 - Keamanan.md>) | Pembuktian (M6) | planned |
| 27 | [Pemindaian dependency, secret, dan kebijakan exception](<006 - Keamanan.md>) | Pembuktian (M6) | planned |
| 28 | [Gate merge penuh, aksesibilitas, dan baseline performa](<006 - Keamanan.md>) | Pembuktian (M6) | planned |
| 29 | [Profil deployment default dan topologi release](<007 - Deployment.md>) | Operasi (M7) | planned |
| 30 | [Profil A: frontend terpisah](<007 - Deployment.md>) | Operasi (M7) | planned |
| 31 | [Profil B: binary tunggal dengan asset embedded](<007 - Deployment.md>) | Operasi (M7) | planned |
| 32 | [Pipeline CI/CD dan release artefak immutable](<007 - Deployment.md>) | Operasi (M7) | planned |
| 33 | [Backup, restore, dan pemulihan schema](<007 - Deployment.md>) | Operasi (M7) | planned |
| 34 | [Dashboard, alert, dan runbook operasi](<007 - Deployment.md>) | Operasi (M7) | planned |
| 35 | [Dokumentasi inti dan panduan ekstensi](<008 - Dokumentasi.md>) | Dokumentasi (M8) | planned |
| 36 | [Onboarding terukur dan penerimaan akhir](<008 - Dokumentasi.md>) | Dokumentasi (M8) | planned |

## Bagian

- [Bagian 1: Fondasi workspace dan toolchain](<001 - Workspace.md>): fitur 1 done; fitur 2 sampai 5 planned.
- [Bagian 2: Fondasi backend dan data](<002 - Backend.md>): fitur 6 sampai 10, semua planned.
- [Bagian 3: Kontrak API dan client Angular](<003 - Kontrak API.md>): fitur 11 sampai 13, semua planned.
- [Bagian 4: Alur awal, yaitu auth, shell, dan RBAC](<004 - Alur awal.md>): fitur 14 sampai 21, semua planned.
- [Bagian 5: Slice contoh projects](<005 - Projects.md>): fitur 22 sampai 24, semua planned.
- [Bagian 6: Keamanan, ketahanan, dan quality gates](<006 - Keamanan.md>): fitur 25 sampai 28, semua planned.
- [Bagian 7: Deployment dua profil dan release](<007 - Deployment.md>): fitur 29 sampai 34, semua planned.
- [Bagian 8: Dokumentasi, onboarding, dan penerimaan akhir](<008 - Dokumentasi.md>): fitur 35 dan 36, semua planned.

## Ditunda

Di luar scope build saat ini, dicatat agar rencana tetap jujur. Setiap item punya alasan dan titik ekstensi.

- **Registrasi publik dan verifikasi email**: butuh transport email; titik ekstensi di modul auth (fitur 14) dan alur login (fitur 18) · needs a decision
- **Transport email**: provider, secret, retry, dan test provider untuk reset password dan notifikasi · needs a decision
- **MFA**: setelah transport email atau TOTP diputuskan; titik ekstensi di alur login (fitur 18) · needs a decision
- **Auth eksternal OIDC**: validasi issuer, audience, signature, rotasi kunci, dan pemetaan identitas ke user serta RBAC lokal; mengganti sebagian fitur 14 · needs a decision
- **Upload file**: storage, batas ukuran, dan pemindaian; titik ekstensi di kontrak (fitur 11) dan modul projects · needs a decision
- **Soft delete**: baseline memakai hard delete dengan audit event; kolom status atau waktu hapus ditetapkan di model data (fitur 7) bila dibutuhkan · needs a decision
- **SSR Angular**: butuh runtime server Node.js dan tidak kompatibel dengan Profil B · needs a decision
- **Lokalisasi dan zona waktu**: baseline satu bahasa dan timestamp UTC di API · needs a decision
- **Outbox dan broker, Redis, multi tenant, billing, workflow engine, event sourcing, Kubernetes, ekstraksi modul menjadi service**: non goal; masuk hanya dengan bukti kebutuhan terukur

## Arti status dan langkah berikutnya

`planned` berarti direncanakan. `in-progress` berarti sebagian implementasi ada tetapi bukti penyelesaian belum lengkap. `existing` berarti telah tersedia sebelum scope ini. `done` memerlukan hasil serta bukti kriteria fitur. `dropped` menyimpan fitur yang dikeluarkan tanpa menghapus sejarah.

File bagian diberi nomor urut sesuai urutan build (`001 - Workspace.md` sampai `008 - Dokumentasi.md`); `index.md` tetap menjadi pintu masuk yang dibaca skill lain.

Kotak pertama yang belum dicentang adalah langkah berikutnya. Label `(spec)` menandai perancangan; tag `needs a decision` hilang setelah spec tertangkap. Setelah spec tersedia, bagian fitur memperoleh tautan spec, langkah `/develop` dengan 2 sampai 5 milestone, lalu langkah verifikasi, test, review, dan dokumentasi sesuai workflow GA. Tugas implementasi rinci berada dalam spec, bukan di scope.

Anda dapat mulai dengan `/architect stack, audit, dan scaffold workspace`. Setelah fitur 1 dan 2 selesai, fitur 3, 4, dan 5 dapat dikerjakan paralel. Fitur 11 dan 12 dapat dirancang bersamaan dengan bagian 2 karena hanya bergantung pada keputusan fitur 1. Fitur 14, 15, dan 16 dapat dirancang paralel; fitur 18 (benang pertama lintas semua lapisan) membutuhkan fitur 13, 14, 16, dan 17 selesai. Keamanan dan test yang relevan dibangun bersama setiap fitur, tanpa menunggu fase pembuktian. Kedua profil deployment wajib diverifikasi sebelum fitur 36 dinyatakan selesai.

Scope ini hanya memeriksa cakupan brief dan keberadaan artefak lokal. Tidak ada build, test, container, atau deployment yang dijalankan atau dinyatakan lulus dalam penyusunan scope.
