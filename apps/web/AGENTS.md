# apps/web

## Overview

Workspace Angular CLI (`angular.json` di sini) sekaligus anggota Bun Workspace bernama `web`. Aplikasi CSR, standalone, zoneless, strict, dengan Vitest dan jsdom untuk unit test. UI akhir, styling, shell, dan routing ditetapkan fitur 15 dan 16.

## Key files

| File | Owns |
| --- | --- |
| `package.json` | Dependency versi tepat dan script yang semuanya diawali guard Node |
| `angular.json` | Builder `@angular/build:application` dan `@angular/build:unit-test`, analytics mati |
| `src/app/app.config.ts` | Provider aplikasi (tanpa zone change detection) |
| `src/app/app.spec.ts` | Unit test bawaan |

## Commands

```bash
bun run build:web                       # dari root
bun run test:web                        # dari root, Vitest tanpa watch
bun run --filter web ng <perintah>      # Angular CLI lain lewat guard
```

## Conventions

- Jangan jalankan `ng`, `npx`, atau `bun ./node_modules/...` langsung; selalu lewat script agar `scripts/guard-node.mjs` memastikan Node, bukan runtime Bun.
- Setelah `ng update` atau `ng add`, kembalikan versi bertanda `^` atau `~` menjadi versi tepat.
- Jangan menambah `zone.js`, SSR, atau `NgModule`.
- Output build ada di `dist/web/browser/`.

## Agent skills

- [angular-new-app](../../.claude/skills/angular-new-app/): `angular/skills`, pembuatan aplikasi Angular
- [ng22-vitest](../../.claude/skills/ng22-vitest/): `pavananguluri/angular22-agent-skills`, test Vitest Angular 22

## Related specs

- [0001 Stack, audit, dan scaffold workspace](../../docs/specs/0001-stack-audit-scaffold-workspace/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
