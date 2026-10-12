# apps/api

## Overview

Binary Axum yang menjadi composition root backend. Saat ini hanya kerangka: router kosong di alamat sementara `127.0.0.1:3000`, tanpa konfigurasi, logging, atau database. Fitur 3 (konfigurasi), 8 (struktur modul), 9 (health dan shutdown), dan 10 (observability) mengisinya.

## Key files

| File | Owns |
| --- | --- |
| `Cargo.toml` | Package `api`, mewarisi `version`, `edition`, `rust-version` dari workspace root |
| `src/main.rs` | Bind listener, cetak satu baris start, jalankan `axum::serve` |
| `tests/skeleton.rs` | Test integrasi yang menjalankan binary asli lewat HTTP mentah |

## Commands

```bash
bun run build:api                 # cargo build --locked -p api
bun run run:api                   # cargo run --locked -p api
cargo test --locked -p api        # butuh port 3000 bebas
```

## Conventions

- Dependency dideklarasikan di `[workspace.dependencies]` root lalu dipakai dengan `workspace = true`; Tokio tetap di jalur LTS (`~1.53`).
- Selalu pakai `--locked` agar `Cargo.lock` tidak berubah diam diam.
- Test integrasi tidak menambah HTTP client; pakai `std::net::TcpStream` sampai spec lain memutuskan alat test HTTP.

## Gotchas

- Port `3000` tetap sampai fitur 3; `cargo test` gagal bila proses lain memakai port itu.
- Mesin development ini menjalankan PostgreSQL Laravel Herd di port 5432 dan 5433.

## Related specs

- [0001 Stack, audit, dan scaffold workspace](../../docs/specs/0001-stack-audit-scaffold-workspace/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
