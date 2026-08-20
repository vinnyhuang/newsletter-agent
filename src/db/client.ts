import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { AGENT_CONCURRENCY } from '../config/agents.ts';
import { databaseUrl } from '../config/env.ts';
import * as schema from './schema.ts';

/**
 * Connection pool size.
 *
 * Sized above `AGENT_CONCURRENCY` because every in-flight agent step also does
 * database work around its model call — `withStep` reads the memo row before
 * and writes the result after — and the graph itself queries concurrently. A
 * pool at exactly the agent concurrency would let bookkeeping queue behind
 * bookkeeping. The headroom covers graph-level reads and the CLI process.
 */
const POOL_SIZE = AGENT_CONCURRENCY + 4;

/**
 * postgres.js keeps a live socket, which holds the Node event loop open. A CLI
 * that forgets `closeDb()` hangs after finishing its work rather than exiting.
 */
const sql = postgres(databaseUrl, {
  max: POOL_SIZE,
  // Surface real problems; suppress routine NOTICE chatter from DDL.
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });

/** Close the pool. Call once at the end of any CLI entry point. */
export async function closeDb(): Promise<void> {
  await sql.end();
}

/** Cheap connectivity check for startup and the Phase 0 exit check. */
export async function pingDb(): Promise<void> {
  await sql`select 1`;
}
