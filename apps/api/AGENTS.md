# apps/api

## Overview

Binary Axum yang menjadi composition root backend. Router masih kosong; konfigurasi dibaca dan divalidasi saat start (spec 0002) lalu listener bind ke `APP_HOST:APP_PORT` (default `127.0.0.1:3000`). Belum ada logging atau koneksi database; fitur 6, 8, 9, dan 10 mengisinya.

## Key files

| File | Owns |
| --- | --- |
| `Cargo.toml` | Package `api`, mewarisi `version`, `edition`, `rust-version` dari workspace root |
| `src/config.rs` | Skema konfigurasi, validasi, tabel pesan, tipe `Secret` |
| `src/main.rs` | Muat konfigurasi (status 78 bila gagal), bind listener, cetak satu baris start, jalankan `axum::serve` |
| `tests/config.rs`, `tests/common/mod.rs` | Test proses konfigurasi dengan env eksplisit dan port bebas |
| `tests/skeleton.rs` | Test integrasi yang menjalankan binary asli lewat HTTP mentah |

## Commands

```bash
bun run build:api                 # cargo build --locked -p api
bun run run:api                   # cargo run --locked -p api; butuh env (spec 0002), keluar 78 tanpa env
cargo test --locked -p api        # butuh port 3000 bebas
```

## Conventions

- Dependency dideklarasikan di `[workspace.dependencies]` root lalu dipakai dengan `workspace = true`; Tokio tetap di jalur LTS (`~1.53`).
- Selalu pakai `--locked` agar `Cargo.lock` tidak berubah diam diam.
- Test integrasi tidak menambah HTTP client; pakai `std::net::TcpStream` sampai spec lain memutuskan alat test HTTP.

## Gotchas

- `tests/skeleton.rs` sengaja memakai port tetap `3000`; `cargo test` gagal bila proses lain memakai port itu. Test lain memakai port bebas dan `env_clear()`.
- Pesan konfigurasi dan status keluar `78` adalah kontrak (spec 0002); jangan mengubah teksnya tanpa memperbarui spec.
- Mesin development ini menjalankan PostgreSQL Laravel Herd di port 5432 dan 5433; PostgreSQL proyek memakai `15432`.

## Related specs

- [0001 Stack, audit, dan scaffold workspace](../../docs/specs/0001-stack-audit-scaffold-workspace/index.md)
- [0002 Konfigurasi tervalidasi dan environment](../../docs/specs/0002-konfigurasi-tervalidasi-environment/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
