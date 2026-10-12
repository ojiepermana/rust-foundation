# Bagian 5: Slice contoh projects

Milestone M5 pada brief: satu vertical slice `projects` yang membuktikan UI, client yang dihasilkan, API, application dan domain, sampai database, termasuk penolakan akses dan E2E utama. Contoh tetap kecil, bukan produk bisnis. Kembali ke [ringkasan scope](index.md).

## Slice contoh (M5)

### 22. Daftar dan detail projects

Daftar projects milik pengguna dengan pagination dan sorting dari allowlist, halaman detail, state loading, empty, dan error, serta reload pada deep link ke detail. Mempertebal jalur baca benang pertama.

**Selesai ketika:** daftar dan detail tampil lewat client yang dihasilkan; URL mencerminkan halaman dan sort; empty state dan error state tampil sesuai pola shell; reload pada deep link detail mempertahankan halaman; user tidak dapat melihat project milik pengguna lain sesuai kebijakan kontrak (403 atau 404).

- [ ] Bangun: `/develop daftar dan detail projects`

### 23. Buat, ubah, dan hapus project dengan kepemilikan

Typed form untuk buat dan ubah, hapus dengan konfirmasi, error validasi per field dari API ke form, pencegahan duplicate submission, idempotency bila dibutuhkan, dan enforcement kepemilikan serta permission di backend. Mempertebal jalur tulis benang pertama.

**Selesai ketika:** saat user B mencoba mengubah atau menghapus project milik user A, API menolak dan UI menampilkan akses ditolak; input tidak valid menghasilkan error per field yang tampil di form; submit ganda tidak membuat dua record; hapus memicu audit event dan hard delete sesuai keputusan model data.

- [ ] Bangun: `/develop buat, ubah, dan hapus project dengan kepemilikan`

### 24. Skenario negatif dan E2E utama

Harness E2E browser dan skenario negatif lintas fitur: login, buat project, logout; RBAC admin dan user; 401 dan 403; reload deep link; API tidak tersedia; sesi dicabut; perubahan hak. Dijalankan pada database terisolasi.

**Selesai ketika:** seluruh skenario di atas lulus di CI pada browser headless; setiap skenario punya ID stabil yang dirujuk dari spec terkait; kegagalan API disimulasikan tanpa jaringan eksternal; suite deterministik dalam tiga run berturut.

- [ ] Bangun: `/develop skenario negatif dan E2E utama`
