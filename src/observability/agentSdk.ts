import * as ClaudeAgentSDK from '@anthropic-ai/claude-agent-sdk';

/**
 * Indirection so the Agent SDK can be swapped for an instrumented copy.
 *
 * Under ESM a module's exports are read-only getters, so the OpenTelemetry
 * instrumentation cannot patch `query` in place — it returns a new module object
 * instead. Anything holding a direct `import { query }` would therefore keep
 * calling the unpatched function and emit no spans. Callers go through
 * `agentQuery` so the handle can be replaced once at startup.
 */
let sdk: typeof ClaudeAgentSDK = ClaudeAgentSDK;

export function useInstrumentedAgentSdk(instrumented: typeof ClaudeAgentSDK): void {
  sdk = instrumented;
}

export const agentQuery: typeof ClaudeAgentSDK.query = (params) => sdk.query(params);
