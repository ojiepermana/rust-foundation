# 0004. Rationale: task root dan lifecycle development

Catatan keputusan untuk [spec 0004](index.md). Bagian ini tidak dibaca `/develop` saat membangun.

## Context

Brief bagian 14 meminta satu antarmuka task root untuk install, dev, build, lint, test, E2E, kontrak, migration, seed, Compose, dan kedua profil, serta lifecycle dev yang menjalankan frontend dan backend bersama proxy, hot reload, log terpisah, penghentian proses anak, deteksi konflik port, dan dukungan lintas OS tanpa layanan production. Spec 0001 menetapkan Bun sebagai task runner dan melarang Angular berjalan di runtime Bun; spec 0002 menetapkan nama variabel backend dan bahwa `.env` dimuat oleh task Bun; spec 0003 menetapkan project `foundation`, service `postgres`, dan task `db:*`.

Banyak task di brief belum bisa berjalan karena fiturnya belum dibangun, padahal scope meminta setiap task berjalan dari clean checkout. Bun memuat `.env`, `.env.local`, dan `.env.<NODE_ENV>` secara otomatis untuk script yang dijalankan langsung dan untuk `bun test`, yang diam diam bisa membawa secret developer ke test. Windows mengunci executable yang sedang berjalan, sehingga build ulang backend saat proses lama hidup akan gagal di sana. Review fitur 1 meminta test cepat dipisah dari test lambat.

## Options considered

### Option 1: Script Bun dan supervisor buatan sendiri

`package.json` root sebagai katalog, supervisor `dev` di TypeScript Bun dengan watcher `fs.watch`, penghentian proses per OS, dan log berawalan.

**Pros**:

- Tanpa alat baru dan tanpa instalasi di luar repo.
- Perilaku penuh dalam kendali proyek, termasuk Windows.

**Cons**:

- Kode supervisor harus dirawat dan diuji di tiga OS.

### Option 2: Paket orkestrasi proses (misalnya concurrently) plus watcher Rust (bacon atau watchexec)

Dev menjalankan beberapa perintah paralel lewat paket npm, backend di-reload alat Rust.

**Pros**:

- Lebih sedikit kode sendiri.

**Cons**:

- Menambah dependency dan binary di luar repo yang tidak diputuskan spec 0001.
- Kontrol penghentian proses dan pesan konflik port terbatas pada perilaku alat.

### Option 3: Task runner terpisah (just atau make)

**Pros**:

- Sintaks task ringkas.

**Cons**:

- Bertentangan dengan keputusan Bun sebagai task runner; make tidak native di Windows.

## Rationale

Option 1 dipilih karena keputusan pengguna (watcher di supervisor Bun, Windows native) dan spec 0001 (Bun sebagai task runner, tanpa alat di luar spec) hanya terpenuhi tanpa alat tambahan. Mendaftarkan task hanya saat fiturnya jalan (pilihan pengguna) menjaga makna "setiap task berjalan dari clean checkout" tetap jujur: task yang ada selalu bekerja, dan katalog mencadangkan nama untuk fitur berikutnya sehingga tidak ada placeholder yang bisa disalahartikan sebagai pemeriksaan yang lulus.

Menjalankan salinan binary backend, bukan binary di `target/debug`, dipilih karena Windows mengunci executable yang sedang berjalan; dengan salinan, build ulang tidak pernah bentrok dengan proses lama di OS mana pun, dan backend lama tetap melayani saat build gagal. Pemicu stdin `q` ditambahkan karena test di Windows tidak bisa mengirim Ctrl+C ke proses konsol lain dengan andal. `--no-env-file` di setiap script Bun dipilih agar pemuatan `.env` selalu eksplisit dan hanya satu file, sesuai spec 0002.

Pemeriksaan silang 2026-10-12 menghasilkan koreksi yang disetujui pengguna. Watcher memakai polling mtime setiap 500 ms, tetap di dalam supervisor Bun sesuai pilihan pengguna, karena `fs.watch` rekursif melaporkan event berbeda di setiap OS dan kehilangan pantauan file yang diganti secara atomik. Dev server dijalankan dengan `bun run --cwd apps/web` agar baris log tidak berawalan ganda. Pemicu berhenti ulang diabaikan selama 1,5 detik karena Ctrl+C lewat `bun run dev` di terminal POSIX mengirim `SIGINT` dua kali. Windows langsung memakai `taskkill /F` karena proses konsol tidak bisa dihentikan dengan sopan oleh `taskkill`. `.gitattributes` memaksa LF karena checkout Windows memakai CRLF, yang membuat `prettier --check` dan hook shell gagal.

