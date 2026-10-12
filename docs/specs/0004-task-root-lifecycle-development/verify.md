# Verify: Task root dan lifecycle development · spec 0004 · updated 2026-10-13

_Langkah diturunkan dari acceptance criteria spec 0004. `/check verify` menjalankannya; `/test` mengunci yang tahan lama._

## Commands

- [x] Bandingkan tabel *Tersedia* di `docs/development.md` dengan script `package.json` root: satu baris per script, perintah sama persis, prasyarat `-`, `env`, `docker`, atau `env, docker`; tabel *Dicadangkan* tidak memuat script yang terdaftar; setiap segmen `bun <file>` dan `bun test` memakai `--no-env-file` → AC-1
- [x] Salin file dari `git ls-files -z --cached --others --exclude-standard` ke direktori sementara, `git init`, commit, `bun ci`, lalu `bun run check`, `bun run build`, `bun run test` tanpa `.env` dan tanpa Docker; `git status --porcelain` kosong → AC-2
- [x] Buat file env sementara dengan dua port bebas, `bun run dev --env-file <file>` → baris `[dev] ready: web http://127.0.0.1:<WEB_DEV_PORT>, api http://127.0.0.1:<APP_PORT>` → AC-3
- [x] Saat `dev` hidup: `GET /` 200 dengan `<app-root`, `GET /config.json` sama dengan `{ "apiBaseUrl": "/api" }`, `GET /api/<acak>` 404 dari backend lewat proxy, `GET /apiary` tidak diteruskan → AC-3
- [x] Tempati `APP_PORT` dan `WEB_DEV_PORT` dengan listener lain, jalankan `dev` → status 1, satu baris per port dengan teks dari tabel pesan, tidak ada `[dev] started`, `[api]`, `[web]`, atau isi `.dev/bin` → AC-4
- [x] `APP_ENV=production`, `WEB_DEV_PORT` sama dengan `APP_PORT`, `POSTGRES_PORT=80` → status 1 dengan tiga pesan validasi; `--env-file` yang tidak ada dan opsi asing → status 1 dengan pesan tabel → AC-4
- [x] Jalankan `dev` dengan `--api-dir` ke workspace Cargo sementara, ubah `main.rs` → `[dev] api restarted` dan respons baru; tulis kode rusak → `[dev] api build failed; previous backend keeps running` dan respons lama tetap → AC-5
- [x] Setiap baris keluaran `dev` diawali `[dev]`, `[api]`, atau `[web]`; `.dev/logs/api.log` memuat `api listening on` dan `.dev/logs/web.log` tidak kosong → AC-6
- [x] Ketik `q` lalu Enter → status 0, baris terakhir `[dev] stopped`, pid dari baris `[dev] started` sudah mati, kedua port bisa di-bind → AC-7
- [x] Kirim `SIGINT` ke process group `bun run dev` (meniru Ctrl+C terminal) → status 0, tanpa `[dev] forcing stop` → AC-7
- [x] Matikan process group dev server dari luar → `[dev] web exited with status <n>; stopping`, status 1, backend ikut berhenti → AC-7
- [x] `DATABASE_URL` tidak valid → `[dev] api exited with status 78 before it was ready; stopping`, status 1 → AC-7
- [x] `POSTGRES_PORT` tertutup → pesan AC-8 muncul dan `dev` tetap siap; ada listener di `POSTGRES_PORT` → tidak ada pesan → AC-8
- [ ] `bun test --no-env-file ./tests/integration/dev.test.ts` lulus di macOS lokal, dan job CI `checks` (Linux) serta `dev-lifecycle` (macOS, Windows) lulus di GitHub Actions → AC-9

## Acceptance-criteria coverage

- AC-1 katalog · AC-2 clean checkout · AC-3 dev, proxy, config.json · AC-4 preflight · AC-5 reload · AC-6 log · AC-7 penghentian · AC-8 database · AC-9 tiga OS
