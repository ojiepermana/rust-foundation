# Bagian 4: Alur awal, yaitu auth, shell, dan RBAC

Milestone M4 pada brief: model auth dan sesi, design system, app shell, bootstrap admin, benang pertama login sampai logout lintas semua lapisan, RBAC, administrasi akses, dan audit event. Kembali ke [ringkasan scope](index.md).

## Alur awal (M4)

### 14. Model autentikasi dan sesi · needs a decision

Bandingkan session sisi server dengan cookie HttpOnly, OIDC atau provider eksternal, dan token; rekomendasi baseline adalah session sisi server dengan cookie Secure, HttpOnly, dan SameSite untuk auth lokal. Tetapkan hashing password dengan parameter terverifikasi, expiry, rotasi sesi saat login dan perubahan hak, revocation saat logout, disable, reset, dan perubahan keamanan, kontrol CSRF yang tidak hanya mengandalkan SameSite, CORS allowlist, validasi origin, dan perilaku pada Profil A bila origin berbeda. Tanpa refresh token bila tidak dibutuhkan.

**Selesai ketika:** spec menetapkan storage sesi, expiry, rotasi, revocation, dan kontrol CSRF beserta skenario same origin dan cross origin; matriks skenario negatif (anonim ditolak, sesi dicabut tidak berlaku, perubahan hak tidak menyisakan izin lama) siap dipakai fitur 18, 19, dan 24.

- [ ] Putuskan model auth dan sesi (spec): `/architect model autentikasi dan sesi`

### 15. Design system dan fondasi UI · needs a decision

Strategi styling dan design token, pilihan component library atau komponen minimal sendiri, layout responsif, navigasi keyboard, manajemen fokus, label form, kontras, target aksesibilitas yang terukur, lazy loading, dan bundle budget. CSR adalah baseline; SSR bukan bagian scope ini.

**Selesai ketika:** `design.md` mencakup tipografi, warna, spacing, dan komponen dasar; komponen dasar lolos pemeriksaan keyboard dan kontras otomatis; bundle budget ditetapkan di konfigurasi build dan gagal bila terlampaui.

- [ ] Rancang design system (spec): `/architect design system dan fondasi UI`

### 16. App shell, routing, dan pola state · needs a decision

Shell aplikasi dengan standalone components, strict typing, routing lazy, signals untuk state, typed forms, inisialisasi auth saat start, guard sebagai bantuan UX, halaman akses ditolak dan tidak ditemukan, perilaku saat sesi kedaluwarsa, redirect aman setelah login, state loading, empty, error, dan success, pemetaan error validasi per field, pembatalan request, retry untuk operasi idempotent, dan pencegahan duplicate submission. Tanpa pustaka state global tambahan tanpa kebutuhan nyata.

**Selesai ketika:** shell memuat lalu menampilkan state yang benar saat API tidak tersedia; deep link ke route terlindungi mengarah ke login lalu kembali ke tujuan yang aman; 403 dan 404 punya halaman sendiri; pola state dan error terdokumentasi di spec untuk dipakai fitur berikutnya.

- [ ] Rancang shell dan pola (spec): `/architect app shell, routing, dan pola state`

### 17. Seed development dan bootstrap admin · needs a decision

Bootstrap admin pertama tanpa credential default di source atau image (misalnya credential satu kali dari environment atau perintah CLI), serta seed dev idempotent untuk pengguna, role, dan contoh project dengan guard agar tidak berjalan di production.

**Selesai ketika:** pada mode production, seed menolak berjalan; bootstrap admin berjalan sekali dan tidak membuat ulang admin pada run berikutnya; tidak ada password tetap di repo, image, atau dokumentasi (dibuktikan pemindaian).

- [ ] Rancang bootstrap dan seed (spec): `/architect seed development dan bootstrap admin`

### 18. Login, logout, dan pengguna saat ini

Benang pertama lintas semua lapisan: form login di shell memanggil client yang dihasilkan, API memvalidasi credential, sesi tersimpan di PostgreSQL, halaman terlindungi menampilkan pengguna saat ini, dan logout mencabut sesi. Nyata di setiap lapisan, hanya sempit cakupannya.

**Selesai ketika:** dengan credential valid, login memasang cookie sesi dan endpoint pengguna saat ini mengembalikan profil; credential salah dan pengguna tidak ada menghasilkan response identik; sesi yang dicabut ditolak dengan 401; anonim ke endpoint terlindungi mendapat 401; percobaan gagal berulang diperlambat; E2E browser login lalu logout lulus.

- [ ] Bangun: `/develop login, logout, dan pengguna saat ini`

### 19. Model role dan permission · needs a decision

Model role ke permission dengan default deny, enforcement di backend per use case dan resource, pemeriksaan kepemilikan untuk mencegah IDOR, matriks role dan permission awal (admin dan user), propagasi perubahan hak ke sesi aktif, dan guard frontend hanya untuk UX.

**Selesai ketika:** matriks permission tercatat di spec; use case tanpa permission eksplisit ditolak; perubahan role berlaku pada request berikutnya tanpa menyisakan izin lama; test integrasi membuktikan user biasa tidak dapat memanggil aksi admin.

- [ ] Rancang model dan enforcement (spec): `/architect model role dan permission`

### 20. Administrasi akses pengguna

Layar admin untuk melihat daftar pengguna, memberi dan mencabut role, serta menonaktifkan akun; menonaktifkan akun mencabut semua sesinya. Mempertebal benang pertama dengan jalur admin.

**Selesai ketika:** admin dapat mengubah role dan menonaktifkan akun dari UI melalui client yang dihasilkan; akun nonaktif tidak dapat login dan sesi lamanya ditolak; user biasa mendapat 403 pada endpoint dan halaman admin; daftar pengguna memakai pagination sesuai kebijakan kontrak.

- [ ] Bangun: `/develop administrasi akses pengguna`

### 21. Audit event keamanan · needs a decision

Audit event untuk login sukses dan gagal, logout, perubahan role, disable akun, bootstrap admin, dan aksi administratif lain; data sensitif diminimalkan; retention dan akses terkontrol; terpisah dari diagnostic log.

**Selesai ketika:** setiap aksi di atas menghasilkan satu audit event dengan aktor, target, waktu, dan request ID; event tidak memuat password atau cookie; hanya admin yang dapat membaca audit event; kebijakan retention tercatat dan dapat dijalankan.

- [ ] Rancang skema dan retention (spec): `/architect audit event keamanan`
