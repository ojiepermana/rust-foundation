# Bagian 8: Dokumentasi, onboarding, dan penerimaan akhir

Milestone M8 pada brief: dokumentasi inti, panduan ekstensi, instruksi coding agent, onboarding terukur, dan penerimaan akhir starterkit dengan kedua profil terverifikasi. Kembali ke [ringkasan scope](index.md).

## Dokumentasi (M8)

### 35. Dokumentasi inti dan panduan ekstensi

README quickstart, prerequisites yang dipin, architecture overview, indeks ADR, referensi environment, panduan regenerasi API client, model auth dan keamanan, panduan testing, contribution guide, troubleshooting, panduan release kedua profil, runbook backup dan incident, serta panduan ekstensi: menambah modul, endpoint lewat kontrak, migration, permission, route frontend, dan test tanpa melanggar batas. Instruksi coding agent ringkas dan dijaga selaras oleh `/sync`.

**Selesai ketika:** setiap dokumen di atas ada dan merujuk perintah task root yang nyata; panduan ekstensi dibuktikan dengan satu kali jalan menambah modul contoh kecil di branch terpisah lalu dibuang; tidak ada perintah di dokumentasi yang gagal saat dijalankan dari clean checkout.

- [ ] Bangun: `/develop dokumentasi inti dan panduan ekstensi`

### 36. Onboarding terukur dan penerimaan akhir

Ukur waktu onboarding developer baru pada clean checkout sampai dev berjalan dan test lulus; jalankan seluruh gate wajib; verifikasi kedua profil; susun Definition of Done starterkit, daftar keputusan yang masih terbuka, dan catatan handoff.

**Selesai ketika:** waktu onboarding tercatat bersama target yang disepakati; seluruh gate wajib hijau pada satu commit yang diberi tag; smoke kedua profil dan latihan recovery tercatat sebagai evidence; daftar keputusan terbuka kosong atau setiap item punya pemilik.

- [ ] Bangun: `/develop onboarding terukur dan penerimaan akhir`
