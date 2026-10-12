# 0003. Rationale: infrastruktur PostgreSQL development

Catatan keputusan untuk [spec 0003](index.md). Bagian ini tidak dibaca `/develop` saat membangun.

## Context

Brief bagian 9 dan 13 meminta Compose development dengan PostgreSQL dan service minimum, volume persisten, prosedur reset yang ditandai destruktif, migrator identity terpisah, least privilege, dan test database yang terisolasi dari data dev. Spec 0001 sudah mengusulkan PostgreSQL 18.6 dari image `postgres:18.6-trixie` dengan Compose `v5.5.1` atau lebih baru, dan mencatat bahwa image 18 memindahkan volume ke `/var/lib/postgresql`, bahwa script init hanya berjalan pada volume kosong, dan bahwa healthcheck sebaiknya lewat TCP karena server sementara saat init hanya listen di socket.

Mesin development ini sudah menjalankan PostgreSQL Laravel Herd di port `5432` dan `5433`, sehingga port default proyek harus berbeda. Spec 0002 menetapkan bahwa backend membaca `DATABASE_URL` dan perintah migration membaca `DATABASE_MIGRATOR_URL`, keduanya dari env, dan bahwa Bun memuat `.env` saat script dijalankan langsung.

Kegagalan paling mahal di fitur ini adalah data development hilang karena test atau perintah yang salah, dan aplikasi yang diam diam berjalan dengan hak DDL sehingga injeksi SQL bisa merusak schema.

## Options considered

### Option 1: Image resmi, satu project Compose, role lewat script init, project test sementara

Image `postgres:18.6-trixie`, Compose di `infrastructure/`, script init membuat role migrator dan runtime, test memakai project sementara dengan tmpfs.

**Pros**:

- Paling sedikit kode milik proyek; image resmi dirawat upstream.
- Isolasi test total dan aman untuk worktree paralel.
- Pemisahan DDL dan DML tersedia sebelum migration pertama.

**Cons**:

- Setiap run test menyalakan PostgreSQL baru.
- Password role terlihat di env container dev.

### Option 2: Image buatan sendiri (mengikuti repo saudara)

Image PostgreSQL dari paket distro dengan entrypoint milik proyek, dipakai juga untuk production.

**Pros**:

- Dev dan production memakai image yang sama.

**Cons**:

- Jauh lebih banyak kode dan perawatan (Dockerfile, verifikasi GPG, entrypoint).
- Keputusan image production milik fitur 29, belum diambil.

### Option 3: Database test di server dev

Database `foundation_test` di cluster yang sama.

**Pros**:

- Paling sederhana dan cepat.

**Cons**:

- Berbagi cluster dan role dengan dev; reset satu menghapus yang lain; tidak aman untuk run paralel.

## Rationale

Option 1 dipilih karena memberi isolasi dan least privilege yang diminta brief dengan kode paling sedikit. Project test sementara (pilihan pengguna) menghilangkan kelas bug state yang tersisa antar run dan langsung mendukung tahap build paralel di worktree terpisah. Image buatan sendiri ditunda ke fitur 29, karena keputusan image production belum ada dan menyamakan dev lebih murah dilakukan setelah keputusan itu.

Default privileges dari migrator dipilih alih alih `GRANT` per tabel di setiap migration, karena aturan yang ditetapkan sekali saat init tidak bisa terlupa saat menulis migration baru. Healthcheck TCP dan `--wait` dipilih agar "siap koneksi" berarti benar benar siap, bukan sekadar container hidup. Konfirmasi reset dengan mengetik nama volume dipilih karena konfirmasi ya atau tidak terlalu mudah diloloskan dengan refleks.

Pemeriksaan silang 2026-10-12 menghasilkan empat koreksi yang disetujui pengguna. Nama project menjadi `foundation-rust` karena repo saudara `foundation/bun` sudah memakai project `foundation` di daemon Docker yang sama, sehingga `db:down` di satu repo akan menghapus container repo lain. Autentikasi `scram-sha-256` dipaksa untuk socket dan loopback karena image resmi memakai `trust` di sana, yang membuat test "password salah ditolak" lulus keliru. File penanda inisialisasi menjadi syarat sehat karena init yang gagal di tengah meninggalkan cluster yang tampak sehat tanpa role. Schema `public` diserahkan ke migrator karena sejak PostgreSQL 15 hanya pemilik database yang boleh membuat objek di sana, sehingga tabel catatan migration fitur 6 akan gagal. Port default menjadi `15432` agar di luar rentang port efemeral macOS.

