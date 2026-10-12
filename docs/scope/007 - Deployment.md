# Bagian 7: Deployment dua profil dan release

Milestone M7 pada brief: keputusan profil default dan topologi release, Profil A frontend terpisah, Profil B binary tunggal, pipeline CI/CD dengan artefak immutable, backup dan restore, serta dashboard, alert, dan runbook. Kembali ke [ringkasan scope](index.md).

## Operasi (M7)

### 29. Profil deployment default dan topologi release · needs a decision

Bandingkan Profil A (frontend terpisah) dan Profil B (binary tunggal) pada kesederhanaan operasi, scaling, CDN, auth dan origin, release coupling, ukuran artefak, konfigurasi runtime, portability, dan batas SSR; pilih default untuk implementasi awal (rekomendasi: Profil A dengan `/api` same origin melalui reverse proxy agar model cookie tidak bercabang). Tetapkan TLS termination, artefak immutable yang dibangun sekali lalu dipromosikan, urutan migration terhadap release, jendela kompatibilitas mundur, promosi staging, dan rollback aplikasi yang berbeda dari rollback database.

**Selesai ketika:** tabel perbandingan dan keputusan default tercatat; kebijakan release dan rollback terdokumentasi dengan langkah yang dapat dijalankan; kedua profil tetap wajib diverifikasi sebelum starterkit dinyatakan selesai.

- [ ] Putuskan profil default dan kebijakan release (spec): `/architect profil deployment default dan topologi release`

### 30. Profil A: frontend terpisah

Image API multi stage, runtime bukan root, minimal, health check, penanganan sinyal, batas resource, `.dockerignore`, tanpa secret di layer; asset Angular di static host atau reverse proxy dengan SPA fallback, cache dan invalidasi; konfigurasi API runtime; CORS, cookie, dan CSRF sesuai origin yang dipilih.

**Selesai ketika:** smoke test pada artefak membuktikan readiness, SPA fallback untuk route frontend, 404 API untuk `/api/*` yang tidak ada, asset dengan hash pada namanya mendapat cache panjang dan HTML entry mendapat cache pendek; image lolos pemindaian; frontend dan backend dapat dirilis terpisah dalam jendela kompatibilitas.

- [ ] Bangun: `/develop profil A frontend terpisah`

### 31. Profil B: binary tunggal dengan asset embedded · needs a decision

Build Angular CSR disematkan saat compile Rust melalui feature atau profile build yang jelas; executable menyajikan asset dan API; PostgreSQL, secret, dan konfigurasi tetap eksternal. Tetapkan urutan build web lalu embed lalu Rust, MIME type, negosiasi kompresi, ETag dan cache header, base path dan deep link, target OS dan libc, batas static linking, ukuran binary, waktu build, patching, dan rollback gabungan.

**Selesai ketika:** satu binary melayani SPA dan API; asset hilang menghasilkan 404, bukan HTML; `/api/*` tidak dikenal menghasilkan 404 API; deep link frontend menghasilkan HTML entry; smoke test yang sama dengan Profil A lulus; ukuran binary dan waktu build tercatat sebagai evidence.

- [ ] Rancang mekanisme embed dan target build (spec): `/architect profil B binary tunggal dengan asset embedded`

### 32. Pipeline CI/CD dan release artefak immutable · needs a decision

Graf job: audit tooling, restore cache per OS, arsitektur, toolchain, lockfile, dan profile, instalasi terkunci, lint dan typecheck, test, generate dan check kontrak, build, pemindaian image dan artefak, smoke staging, dan release. Credential CI least privilege, environment secrets, kebijakan approval deployment, tagging release, SBOM dan provenance bila tersedia, serta bagian yang portable antar provider.

**Selesai ketika:** pipeline membangun artefak sekali dan mempromosikannya ke staging lalu production tanpa rebuild; smoke staging otomatis sebelum promosi; cache terpisah per dimensi yang disebutkan; release diberi tag dan artefak dapat ditelusuri ke commit.

- [ ] Rancang graf job dan kebijakan release (spec): `/architect pipeline CI/CD dan release artefak immutable`

### 33. Backup, restore, dan pemulihan schema · needs a decision

Prosedur backup PostgreSQL, verifikasi restore terjadwal, retention, target RPO dan RTO sebagai usulan yang dikaitkan dengan kebutuhan Anda, pemulihan saat migration gagal, forward fix, dan latihan recovery pada staging.

**Selesai ketika:** restore dari backup terbaru berhasil pada staging dengan data terverifikasi; migration yang gagal di tengah dapat dipulihkan mengikuti runbook; RPO dan RTO tercatat sebagai hipotesis beserta cara mengukurnya.

- [ ] Tetapkan target dan prosedur (spec): `/architect backup, restore, dan pemulihan schema`

### 34. Dashboard, alert, dan runbook operasi

Dashboard dan alert minimum untuk latency, error, availability, saturasi pool, dan auth failure rate; pelaporan error frontend sesuai keputusan spec fitur 10; runbook untuk database down, migration gagal, secret tidak valid, dan rollback release.

**Selesai ketika:** dashboard dan alert ada di staging dengan ambang awal yang didokumentasikan sebagai hipotesis; setiap runbook pernah dilatih sekali di staging dengan catatan hasil; error frontend terkirim dengan request ID yang dapat dicocokkan ke log backend.

- [ ] Bangun: `/develop dashboard, alert, dan runbook operasi`
