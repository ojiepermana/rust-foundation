# apps/web

## Overview

Workspace Angular CLI (`angular.json` di sini) sekaligus anggota Bun Workspace bernama `web`. Aplikasi CSR, standalone, zoneless, strict, dengan Vitest dan jsdom untuk unit test. UI akhir, styling, shell, dan routing ditetapkan fitur 15 dan 16.

## Key files

| File | Owns |
| --- | --- |
| `package.json` | Dependency versi tepat dan script yang semuanya diawali guard Node |
| `angular.json` | Builder `@angular/build:application` dan `@angular/build:unit-test`, analytics mati |
| `src/app/app.config.ts` | Provider aplikasi (tanpa zone change detection) |
| `src/app/config/app-config.ts` | Pemuat dan validator `/config.json`, token `APP_CONFIG`, `startApp` |
| `public/config.json` | Konfigurasi runtime publik default (`apiBaseUrl: /api`) |
| `proxy.conf.mjs` | Proxy dev server untuk `^/api(/|$)` ke `DEV_API_TARGET` yang diisi `bun run dev` |
| `src/app/app.spec.ts` | Unit test bawaan |

## Commands

```bash
bun run build:web                       # dari root
bun run test:web                        # dari root, Vitest tanpa watch
bun run --filter web ng <perintah>      # Angular CLI lain lewat guard
bun run dev                             # dari root: dev server, backend, dan proxy (spec 0004)
```

## Conventions

- Jangan jalankan `ng`, `npx`, atau `bun ./node_modules/...` langsung; selalu lewat script agar `scripts/guard-node.mjs` memastikan Node, bukan runtime Bun.
- Setelah `ng update` atau `ng add`, kembalikan versi bertanda `^` atau `~` menjadi versi tepat.
- Jangan menambah `zone.js`, SSR, atau `NgModule`.
- Output build ada di `dist/web/browser/`.
- `start` (`ng serve`) hanya dijalankan lewat `bun run dev`; tanpa `DEV_API_TARGET` file proxy melempar error.
- Konfigurasi hanya dari `/config.json` saat runtime lewat `APP_CONFIG`; jangan memakai `environment*.ts`, `fileReplacements`, `define`, atau `process.env` (spec 0002). Semua isi `config.json` publik.

## Agent skills

- [angular-new-app](../../.claude/skills/angular-new-app/): `angular/skills`, pembuatan aplikasi Angular
- [ng22-vitest](../../.claude/skills/ng22-vitest/): `pavananguluri/angular22-agent-skills`, test Vitest Angular 22

## Related specs

- [0001 Stack, audit, dan scaffold workspace](../../docs/specs/0001-stack-audit-scaffold-workspace/index.md)
- [0002 Konfigurasi tervalidasi dan environment](../../docs/specs/0002-konfigurasi-tervalidasi-environment/index.md)
- [0004 Task root dan lifecycle development](../../docs/specs/0004-task-root-lifecycle-development/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
