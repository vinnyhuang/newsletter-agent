/**
 * Tuning constants for agent execution.
 */

/**
 * Maximum agent calls in flight at once.
 *
 * Set for rate-limit safety, not throughput. This is a weekly batch job with no
 * latency requirement: at ~150 triage calls and ~30 summaries, concurrency 4
 * finishes the pipeline in roughly 20-30 minutes, and 12 might finish it in 10.
 * Nothing is gained by the second number, and it multiplies the chance of
 * tripping a subscription rate limit mid-run.
 *
 * Also bounds subprocess pressure: each `query()` spawns a Claude Code CLI
 * child process at roughly 150-300MB RSS.
 *
 * Per-step concurrency is deliberately not modelled here. Triage, summarize,
 * and digest have very different token profiles, but which one actually binds
 * is unknowable until real weeks exist — so P0-4 records `queue_wait_ms` per
 * step and Phase 7 decides from data rather than from a guess.
 */
export const AGENT_CONCURRENCY = 4;

/**
 * Runaway guard: hard ceiling on total agent calls within a single run.
 *
 * If segmentation misfires and yields thousands of story units, the run should
 * stop and say so rather than reveal the problem by exhausting a week of rate
 * limit. Sized well above a normal week (~150 triage + ~30 summaries + ~15 in
 * the converged tail) so it never fires in normal operation — if it does fire,
 * something upstream is wrong and the right response is to look, not to raise
 * the ceiling.
 */
export const MAX_AGENT_CALLS_PER_RUN = 500;

/**
 * Ceiling on a single agent call's reported cost, before it is aborted.
 *
 * Bounds one runaway call — a loop that keeps calling tools, or a prompt that
 * elicits an enormous response. Under subscription auth the figure the SDK
 * reports is a notional API price rather than billed spend, but it tracks token
 * volume closely enough to serve as a guard. Set well above a normal call so it
 * only fires on genuinely anomalous ones.
 */
export const DEFAULT_AGENT_BUDGET_USD = 2;
