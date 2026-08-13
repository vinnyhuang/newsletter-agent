import { z } from 'zod';

// Node 22 can read a .env file without a dependency. Absent file is fine —
// in CI or a container the values come from the real environment.
try {
  process.loadEnvFile();
} catch {
  // no .env present; fall through to process.env as-is
}

/**
 * `.env` holds secrets and per-machine values only. Decisions about how the
 * system behaves belong in a versioned config module — see `agents.ts` — and
 * ad-hoc overrides come from CLI flags, not from here.
 *
 * The database is declared as its component parts rather than a single URL,
 * because `docker-compose.yml` also reads this `.env` and needs the user,
 * password, database name, and host port individually. Storing a URL as well
 * would mean two representations of the same thing drifting apart; instead the
 * URL is assembled from these below.
 */
const EnvSchema = z.object({
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().min(1),

  ARTIFACTS_DIR: z.string().default('./data/artifacts'),

  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASEURL: z.url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    // Fail loudly at startup with every problem at once, rather than throwing
    // somewhere deep in a pipeline run when a value is first dereferenced.
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\n\nSee .env.example.`,
    );
  }

  return parsed.data;
}

/** Validated once at import. Import this rather than reading process.env. */
export const env = loadEnv();

/**
 * The Postgres connection string, assembled from the parts above.
 *
 * User and password are percent-encoded: a password containing `@`, `:`, or `/`
 * would otherwise be parsed as part of the host or path and produce a
 * confusing connection failure rather than an obvious one.
 */
export const databaseUrl = `postgres://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(
  env.POSTGRES_PASSWORD,
)}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`;

/** True when Langfuse credentials are present; tracing is optional. */
export const langfuseEnabled =
  Boolean(env.LANGFUSE_PUBLIC_KEY) &&
  Boolean(env.LANGFUSE_SECRET_KEY) &&
  Boolean(env.LANGFUSE_BASEURL);
