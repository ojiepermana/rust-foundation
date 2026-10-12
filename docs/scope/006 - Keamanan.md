# Bagian 6: Keamanan, ketahanan, dan quality gates

Milestone M6 pada brief: pemulihan akun, hardening HTTP dengan threat model, pemindaian dependency dan secret, serta gate merge penuh dengan aksesibilitas dan baseline performa. Kembali ke [ringkasan scope](index.md).

## Pembuktian (M6)

### 25. Pemulihan akun tanpa email · needs a decision

Jalur reset password untuk auth lokal tanpa transport email (misalnya tautan atau kode satu kali yang dibuat admin dengan masa berlaku), pencegahan user enumeration, dan pencabutan semua sesi saat password berubah. Reset lewat email menjadi ekstensi saat transport email diputuskan.

**Selesai ketika:** admin dapat memulai reset untuk satu pengguna; token satu kali kedaluwarsa dan tidak dapat dipakai dua kali; setelah reset semua sesi lama ditolak; alur tidak membedakan pengguna ada dan tidak ada dalam response.

- [ ] Rancang jalur pemulihan (spec): `/architect pemulihan akun tanpa email`

### 26. Hardening keamanan HTTP dan threat model · needs a decision

Threat model ringkas (aset, trust boundary, aktor, ancaman prioritas, kontrol, cara verifikasi) dipetakan ke OWASP ASVS sesuai scope tanpa klaim sertifikasi. Kontrol: security headers dan CSP yang diuji bersama Angular, CORS allowlist, kontrol CSRF, rate limit dan throttling auth, batas ukuran dan waktu request, validasi input, bukti pencegahan SQL injection, redaction, least privilege database dan runtime, serta rotasi secret.

**Selesai ketika:** threat model dan pemetaan ASVS tercatat di spec; test negatif membuktikan CSRF cross site ditolak, origin di luar allowlist ditolak, body melebihi batas ditolak, dan throttling aktif; CSP tidak merusak aplikasi (E2E lulus dengan CSP aktif); pemeriksaan konfigurasi production tidak aman gagal cepat.

- [ ] Susun threat model dan kontrol (spec): `/architect hardening keamanan HTTP dan threat model`

### 27. Pemindaian dependency, secret, dan kebijakan exception · needs a decision

Pemindaian keamanan dependency Rust dan JavaScript, deteksi secret, kebijakan lisensi, workflow pembaruan dependency, dan kebijakan exception yang punya pemilik serta tanggal kedaluwarsa, bukan allowlist permanen.

**Selesai ketika:** CI gagal pada temuan di atas ambang yang disepakati dan pada secret terdeteksi; setiap exception tercatat dengan pemilik dan expiry, dan CI gagal saat expiry lewat; pembaruan dependency berjalan lewat PR terjadwal.

- [ ] Pilih pemindai dan tetapkan kebijakan (spec): `/architect pemindaian dependency, secret, dan kebijakan exception`

### 28. Gate merge penuh, aksesibilitas, dan baseline performa

Lengkapi gate: fast PR checks, full merge checks, dan scheduled checks; aturan batas modul; drift kontrak nol; coverage berdasarkan risiko; kebijakan flaky test dan isolasi; pemeriksaan aksesibilitas otomatis pada halaman kunci; bundle budget; baseline latency dan error dengan SLO awal sebagai hipotesis yang diukur, bukan diklaim.

**Selesai ketika:** tiga tingkat pipeline terdokumentasi dan berjalan; pemeriksaan aksesibilitas otomatis lulus pada halaman login, daftar, form, dan admin; angka baseline latency dan bundle tersimpan sebagai evidence beserta cara pengukurannya; flaky test dikarantina dengan pemilik dan tenggat.

- [ ] Bangun: `/develop gate merge penuh, aksesibilitas, dan baseline performa`
