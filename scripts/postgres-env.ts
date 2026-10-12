// Shared constants of the development PostgreSQL (spec 0003), used by scripts/db.ts and the root tasks.

// Host port of the development database when POSTGRES_PORT is not set.
// Must match the default in infrastructure/compose.yaml; scripts/db.test.ts checks both agree.
export const DEFAULT_POSTGRES_PORT = 15432;
