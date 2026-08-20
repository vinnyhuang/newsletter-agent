/**
 * Model IDs are pinned explicitly and never resolved from an alias at runtime.
 *
 * The point is attributability: a Phase 3 eval result has to stay tied to a
 * specific model. If we passed an alias, a model release could silently change
 * what a recorded score means, and the labeled-set numbers would drift without
 * a corresponding commit.
 *
 * Rationale for each tier is in the plan doc's "Model tiering" section.
 */

export const MODEL_IDS = {
  SONNET: 'claude-sonnet-5',
  OPUS: 'claude-opus-5',
  HAIKU: 'claude-haiku-4-5',
} as const;

export type ModelId = (typeof MODEL_IDS)[keyof typeof MODEL_IDS];

/**
 * One entry per agent-backed step. Changing a value here is a deliberate act
 * that should be accompanied by a re-run of the relevant eval suite.
 */
export const STEP_MODELS = {
  /** One call per List A email. Golden-file tested from Phase 2. */
  segment: MODEL_IDS.SONNET,

  /**
   * The highest-leverage decision in the pipeline and the largest call volume,
   * so this choice dominates weekly rate-limit consumption. Fixed regardless of
   * volume; Phase 3's labeled set decides whether it should be OPUS.
   */
  triage: MODEL_IDS.SONNET,

  summarize: MODEL_IDS.SONNET,

  /** One call over the whole week so stories are ranked against each other. */
  score: MODEL_IDS.SONNET,

  digest: MODEL_IDS.SONNET,
  aggregation: MODEL_IDS.SONNET,

  /** Once per run, reasoning over run statistics. */
  meta: MODEL_IDS.OPUS,
} as const satisfies Record<string, ModelId>;

export type StepName = keyof typeof STEP_MODELS;

/**
 * Haiku is intentionally unused by default. It is a Phase 7 candidate for
 * segmentation only, and only if the golden-file suite shows parity.
 */
