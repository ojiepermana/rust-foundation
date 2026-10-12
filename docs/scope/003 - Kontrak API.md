# Bagian 3: Kontrak API dan client Angular

Milestone M3 pada brief: satu sumber kebenaran OpenAPI, generator client Angular, dan endpoint pertama yang membuktikan alur kontrak sampai gate drift di CI. Kembali ke [ringkasan scope](index.md).

## Kontrak (M3)

### 11. Sumber kebenaran OpenAPI dan kebijakan kontrak · needs a decision

Satu kontrak canonical di `contracts/`: spec first, atau code derived dengan mekanisme persetujuan sebelum implementasi dan pencegahan drift, bukan dua kontrak. Kebijakan: versi OpenAPI yang didukung semua tooling, prefix dan versioning API, `operationId` stabil, security scheme, representasi timestamp dan zona waktu, UUID, nullability, enum, decimal dan int64 yang aman di JavaScript, error envelope atau Problem Details dengan error per field dan request ID, pagination, allowlist sorting dan filtering, batas payload, status HTTP, idempotency, DTO terpisah dari model domain, serta akses dokumentasi API di production.

**Selesai ketika:** kontrak valid dan lolos lint di CI; aturan breaking dan tidak breaking terdokumentasi dan deteksi breaking change berjalan di CI; setiap kebijakan di atas punya contoh di kontrak; keputusan spec first atau code derived tercatat beserta cara drift dicegah.

- [ ] Tetapkan sumber kebenaran dan kebijakan (spec): `/architect sumber kebenaran OpenAPI dan kebijakan kontrak`

### 12. Generator client Angular · needs a decision

Pilih generator yang menghasilkan client untuk Angular HttpClient dan terverifikasi pada Angular 22 atau lebih baru, termasuk dependency generator, template kustom bila perlu, mekanisme credentials dan pemetaan error, generation deterministik ke `packages/api-client`, strategi commit artefak versus generate saat build, dan freshness gate.

**Selesai ketika:** dua kali generate dari kontrak yang sama menghasilkan output identik; client terpasang di `apps/web` dan lolos typecheck strict; file hasil generate tidak diedit manual (gate CI); dukungan versi Angular dibuktikan, bukan diasumsikan.

- [ ] Pilih generator dan strategi artefak (spec): `/architect generator client Angular`

### 13. Endpoint pertama lewat kontrak dan gate drift

Benang pertama alur kontrak: desain satu endpoint sederhana (misalnya versi aplikasi) di kontrak, lint, generate client, implementasi server, contract test, lalu gate drift di CI. Membuktikan urutan kerja sebelum endpoint auth dibuat.

**Selesai ketika:** contract test memeriksa response aktual, error, dan security scheme terhadap kontrak, bukan hanya snapshot file; CI gagal bila server, kontrak, atau client tidak selaras; client yang dihasilkan memanggil endpoint tersebut dari test unit Angular.

- [ ] Bangun: `/develop endpoint pertama lewat kontrak dan gate drift`
