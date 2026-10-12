# Verify: Infrastruktur PostgreSQL development · spec 0003 · updated 2026-10-12

_Langkah diturunkan dari acceptance criteria spec 0003. `/check verify` menjalankannya; `/test` mengunci langkah yang tahan lama._

Password selalu dibuat saat itu juga sebagai variabel env shell (misalnya `openssl rand -hex 24`), tidak pernah ditulis ke file di repo dan tidak pernah dicetak. Reset destruktif hanya dicoba pada project sementara `foundation-test-*` lewat `COMPOSE_PROJECT_NAME`, tidak pernah pada `foundation-rust`.

## UI / manual

- [ ] Di terminal interaktif, `bun run db:reset` pada project sementara menampilkan `DESTRUCTIVE: this deletes all data in volume <nama>. Type the volume name to continue: `; jawaban salah, Ctrl+C, dan Ctrl+D (EOF) masing masing keluar `1` dengan `database: reset cancelled; confirm with --confirm=<nama>` dan volume tetap ada; mengetik nama volume yang tepat menghapus data lalu service sehat lagi → AC-4

## Commands

- [ ] `bun run db:up` dengan tiga password valid di env shell dan `POSTGRES_PORT` kosong → status `0` hanya setelah sehat; `docker compose -f infrastructure/compose.yaml ps --format json postgres` menunjukkan `Health` `healthy`, satu publisher `127.0.0.1:15432` → AC-1
- [ ] `bun run db:status` → keluaran `docker compose ps` memuat `healthy`, status `0`; setelah `db:down` status tetap `0` walau service tidak berjalan → AC-1
- [ ] `bun run db:up` ketika port host sudah dipakai (project sementara dengan `POSTGRES_PORT` yang sedang di-listen proses lain) → error Docker diteruskan, pesan `database: postgres did not become healthy; ...`, status bukan nol → AC-1
- [ ] `bun run db:up` dan `bun run db:reset` dengan password kosong, pendek, sama, atau `POSTGRES_PORT=80` → status `1`, stderr `database configuration error:` lalu satu baris per variabel sesuai tabel pesan, tanpa nilai password, dan tanpa pemeriksaan Docker (berlaku juga saat `docker` tidak ada di PATH) → AC-2
- [ ] Tulis satu baris lewat migrator, catat `system_identifier`, `bun run db:down`, pastikan `docker volume inspect foundation-rust_postgres_data` masih berhasil serta container dan network hilang, lalu `bun run db:up` → identifier dan baris sama → AC-3
- [ ] `bun run db:reset` pada project sementara tanpa konfirmasi (stdin pipe), stdin tertutup, `--confirm=<nama lain>`, dan `--confirm <nama>` dengan spasi → status `1`, volume tetap ada; `--confirm=<nama volume>` → status `0`, data hilang, service sehat → AC-4
- [ ] `bun --no-env-file scripts/db.ts --help` → baris `reset` diawali `DESTRUCTIVE` → AC-4
- [ ] `bun test --no-env-file ./tests/integration/postgres.test.ts` → matriks hak role, `pg_roles`, ACL `PUBLIC`, dan password salah (status `2`, `password authentication failed`) lulus → AC-5
- [ ] Setelah suite integrasi, `docker ps -a --filter name=foundation-test`, `docker volume ls --filter name=foundation-test`, dan `docker network ls --filter name=foundation-test` kosong; project `foundation-rust` tidak berubah → AC-6
- [ ] `.env.example` memuat blok infrastruktur spec 0003 persis, tanpa nilai password → AC-7

## Value sourcing

- [ ] Port host: `POSTGRES_PORT` kosong memakai `DEFAULT_POSTGRES_PORT` (`15432`, sama dengan default Compose); `POSTGRES_PORT=<port bebas>` pada project sementara mempublikasikan `127.0.0.1:<port bebas>` → AC-1
- [ ] Password tiga role: nilai dari env shell menang atas `.env`; nilai env yang kosong diisi dari file; koneksi dengan password yang diberikan berhasil, password lain ditolak → AC-1, AC-5
- [ ] Nama project, service, role, database: `docker compose -f infrastructure/compose.yaml config --format json` menunjukkan `foundation-rust`, service `postgres` saja, `POSTGRES_USER` `foundation_admin`, `POSTGRES_DB` `foundation` → AC-1
- [ ] Nama volume konfirmasi reset berasal dari Compose: dengan `COMPOSE_PROJECT_NAME=foundation-test-<hex>` pesan penolakan menyebut `foundation-test-<hex>_postgres_data`, bukan `foundation-rust_postgres_data` → AC-4
- [ ] Project test: nama `foundation-test-<16 heksadesimal>`, tiga password 32 heksadesimal berbeda, port host dipilih Docker → AC-6

## Acceptance-criteria coverage

- AC-1: `db:up`, `db:status`, port terpakai, value sourcing port dan nama
- AC-2: validasi variabel sebelum Docker
- AC-3: `db:down` lalu `db:up` dengan identifier dan data sama
- AC-4: reset tanpa konfirmasi, salah, EOF, Ctrl+C, terminal interaktif, `--confirm=`, bantuan `DESTRUCTIVE`, nama volume dari Compose
- AC-5: suite integrasi untuk role, hak, dan password salah
- AC-6: project sementara, pembersihan, value sourcing project test
- AC-7: blok `.env.example`
