import * as ClaudeAgentSDK from '@anthropic-ai/claude-agent-sdk';
import { ClaudeAgentSDKInstrumentation } from '@arizeai/openinference-instrumentation-claude-agent-sdk';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { langfuseEnabled } from '../config/env.ts';
import { useInstrumentedAgentSdk } from './agentSdk.ts';

/**
 * Tracing for agent calls, exported to a self-hosted Langfuse.
 *
 * Started explicitly by CLI entry points rather than as an import side effect,
 * so importing anything from this module in a test does not open an exporter.
 * The usual "import instrumentation first" rule exists because auto-patching
 * must beat module loading; that does not apply here, since the Agent SDK is
 * patched by hand (see `agentSdk.ts`).
 *
 * Everything no-ops when Langfuse credentials are absent — a run must not
 * depend on the tracing sidecar being up.
 */

let sdk: NodeSDK | undefined;

export function startObservability(): void {
  if (sdk || !langfuseEnabled) return;

  sdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        // The default admits `gen_ai.*` spans and instrumentors Langfuse knows
        // about. Everything reaching this process is either an agent call or a
        // span we opened ourselves, since no auto-instrumentations are
        // registered — so the filter would only risk dropping wanted spans.
        // Narrow this if auto-instrumentation is ever added.
        shouldExportSpan: () => true,
      }),
    ],
  });
  sdk.start();

  const instrumentation = new ClaudeAgentSDKInstrumentation();
  useInstrumentedAgentSdk(instrumentation.manuallyInstrument(ClaudeAgentSDK));
}

/**
 * Flushes pending spans. A CLI that exits without this loses the trace for the
 * work it just did, because the processor batches.
 */
export async function shutdownObservability(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}
