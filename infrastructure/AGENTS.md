# infrastructure

## Overview

Compose untuk PostgreSQL development (project `foundation-rust`, satu service `postgres`) beserta script init yang membuat role migrator dan runtime dengan privilege minimum. Dipakai lewat task `db:*` dan oleh harness test yang menyalakan project sementara.

## Key files

| File | Owns |
| --- | --- |
| `compose.yaml` | Service `postgres` dari `postgres:18.6-trixie`, port `127.0.0.1:15432`, volume `foundation-rust_postgres_data`, healthcheck dengan file penanda init |
| `compose.test.yaml` | Override test: port host efemeral |
| `compose.test-tmpfs.yaml` | Override test: data di tmpfs, hanya mount init yang dipertahankan |
| `postgres/initdb/10-roles.sh` | Membuat `foundation_migrator` dan `foundation_app`, mencabut hak `PUBLIC`, default privileges, menulis file penanda |

## Commands

```bash
bun run db:up      # nyalakan sampai sehat
bun run db:status  # status service
bun run db:down    # hentikan, volume tetap
bun run db:reset   # DESTRUCTIVE: minta nama volume
```

## Conventions

- Jangan menjalankan Compose dengan nama project `foundation`; itu milik repo saudara di daemon yang sama.
- Perubahan hak role dilakukan di `10-roles.sh` dan dibuktikan di `tests/integration/postgres.test.ts`; script init hanya berjalan pada volume kosong.
- Test memakai harness `scripts/testing/postgres.ts` (project `foundation-test-*`), tidak pernah project `foundation-rust`.
- `$PGDATA` di `compose.yaml` ditulis `$$PGDATA` agar tidak diinterpolasi dari env host.

## Gotchas

- Password role hanya berlaku saat volume pertama kali diinisialisasi; setelah mengganti password di `.env`, jalankan `db:reset` atau `ALTER ROLE`.
- Init yang gagal tidak pernah sehat (file penanda tidak ada); `db:up` menyarankan `db:reset`.

## Related specs

- [0003 Infrastruktur PostgreSQL development](../docs/specs/0003-infrastruktur-postgresql-development/index.md)

_Drafted by /sync from the introducing change, worth a quick human pass._
