import { defineConfig } from 'drizzle-kit';
import { databaseUrl } from './src/config/env.ts';

/**
 * drizzle-kit is a dev-time CLI only — it generates migration SQL by diffing
 * `schema.ts` against the migrations already on disk. It is never imported by
 * the running application; `drizzle-orm` is the runtime half.
 *
 * Builds its connection string through the same validated env module the app
 * uses, so there is one source of truth.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: { url: databaseUrl },
  // Emit the SQL and let us read it before it touches the database.
  verbose: true,
  strict: true,
});
