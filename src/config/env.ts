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
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),

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

/** True when Langfuse credentials are present; tracing is optional. */
export const langfuseEnabled =
  Boolean(env.LANGFUSE_PUBLIC_KEY) &&
  Boolean(env.LANGFUSE_SECRET_KEY) &&
  Boolean(env.LANGFUSE_BASEURL);
