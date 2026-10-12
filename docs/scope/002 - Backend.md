# Bagian 2: Fondasi backend dan data

Milestone M2 pada brief: akses data dan migration, model data inti, kerangka Axum dengan batas modul, health check, dan observability. Kembali ke [ringkasan scope](index.md).

## Fondasi backend (M2)

### 6. Akses data dan tooling migration · needs a decision

Pilih pustaka akses data dan runner migration dengan tradeoff nyata (pemeriksaan query saat compile dan kebutuhan metadata offline, pool, TLS, timeout, retry aman, resource budget). Tetapkan lifecycle migration: create, review, apply, status, versioning, lock saat concurrency, urutan terhadap release, identitas migrator terpisah, kebijakan expand lalu contract, backfill, forward fix, dan larangan migration otomatis per replika tanpa koordinasi.

**Selesai ketika:** migration dari database kosong dan upgrade dari release sebelumnya berjalan lewat task root; dua proses apply bersamaan tidak saling merusak; status migration dapat dibaca; metadata offline (bila dibutuhkan) punya freshness check di CI; pool, timeout, dan penutupan koneksi saat shutdown terbukti pada test integrasi dengan PostgreSQL nyata.

- [ ] Pilih tooling dan lifecycle migration (spec): `/architect akses data dan tooling migration`

### 7. Model data inti · needs a decision

Entitas inti yang dipakai semua fitur: users, roles, permissions, relasi role ke permission dan user ke role, sessions sesuai model auth, audit events, dan projects untuk slice contoh. Tetapkan kepemilikan tabel per modul, constraint, index, transaction boundary, penanganan concurrency, dan hard delete dengan audit event (soft delete menjadi titik ekstensi).

**Selesai ketika:** migration awal membuat seluruh entitas dengan constraint dan index; setiap tabel punya modul pemilik yang tercatat; test integrasi membuktikan constraint unik dan foreign key; tidak ada modul yang membaca tabel milik modul lain lewat SQL langsung.

- [ ] Rancang entitas dan kepemilikan (spec): `/architect model data inti`

### 8. Kerangka aplikasi Axum dan batas modul · needs a decision

Composition root di `apps/api`, crate per modul bisnis di `crates/`, batas transport, application, domain, dan infrastructure (domain tidak bergantung pada Axum atau database), state dan dependency injection, transaction boundary, pemetaan error ke envelope konsisten, kebijakan background work dan graceful shutdown, serta domain event in process bila diperlukan. Termasuk aturan dependency graph tanpa siklus, shared kernel minimal, gate pelanggaran batas, coupling yang sengaja diterima beserta mitigasinya, dan dokumentasi jalur ekstraksi satu modul beserta biayanya.

**Selesai ketika:** kerangka melayani satu request melalui lapisan yang terpisah; error domain dan validasi dipetakan ke envelope yang disepakati tanpa membocorkan detail internal; gate otomatis menolak dependency antar crate yang melanggar aturan; shutdown menunggu request yang berjalan sampai batas waktu; jalur ekstraksi modul terdokumentasi di spec.

- [ ] Rancang struktur modul dan aturan batas (spec): `/architect kerangka aplikasi Axum dan batas modul`

### 9. Health check dan graceful shutdown

Endpoint liveness, readiness, dan startup yang terpisah; readiness mencerminkan dependency kritis, liveness tidak memicu restart beruntun saat database sementara gagal; informasi pada endpoint publik dibatasi. Penanganan sinyal, drain, dan batas waktu shutdown mengikuti kebijakan spec fitur 8.

**Selesai ketika:** saat database dibuat tidak tersedia, readiness gagal sementara liveness tetap sukses, dan setelah database pulih readiness kembali sukses tanpa restart; SIGTERM menghentikan proses bersih dengan exit code yang didokumentasikan; endpoint publik tidak memuat versi dependency atau detail koneksi.

- [ ] Bangun: `/develop health check dan graceful shutdown`

### 10. Observability dasar · needs a decision

Structured logging dengan field tetap, request dan correlation ID, tracing lintas HTTP dan database, metrics dasar (latency, error, saturasi pool, auth failure rate), redaction, sampling, kendali cardinality, pilihan exporter (OpenTelemetry bila proporsional), metadata release dan versi, serta pemisahan audit log dari diagnostic log. Sertakan keputusan pelaporan error frontend.

**Selesai ketika:** setiap response membawa request ID yang sama dengan log; log tidak memuat password, cookie, atau secret (dibuktikan test); metrics dasar dapat dibaca dari endpoint internal; trace menghubungkan handler dengan query database; build membawa versi dan commit yang tampil di endpoint internal.

- [ ] Rancang field, exporter, dan kebijakan (spec): `/architect observability dasar`
