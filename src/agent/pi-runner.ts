/**
 * PiAgentRunner — the real Pi SDK adapter behind the AgentRunner seam.
 *
 * Ports the runValidation() recipe from validation-agent-poc/src/validate.ts
 * into the stet AgentRunner contract. Key differences from the POC:
 *   - Uses SubmitTool (guard 1 + guard 2) instead of an inline captured variable.
 *   - Returns Result<AgentRunSuccess, AgentError> — never throws across the boundary.
 *   - System prompt IS the rubric (inputs.rubric), not a separate prompt builder.
 *   - Toolset comes from inputs.toolset (phase-owned, mutation-free by construction).
 *   - Cost is read from session.getSessionStats() after prompt() resolves.
 *
 * SDK version: @earendil-works/pi-coding-agent ^0.79.1
 * (Note: 0.78.0 was requested; 0.79.1 was installed by vp add — API is compatible.)
 *
 * PRD refs: §3.1 (output-as-tool guards), §3.2 (mutation-free), §4.4 (cost).
 * Plan refs: §2a M2 T10, decisions P1/P7/P10.
 */

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import { CancelledError, ModelError, NoSubmitError } from "../errors.js";
import type { AgentError } from "../errors.js";
import type { AgentRunInputs, AgentRunSuccess, AgentRunner } from "./runner.js";
import { SubmitTool } from "./submit-tool.js";

// ---------------------------------------------------------------------------
// PiAgentRunner
// ---------------------------------------------------------------------------

/**
 * Real Pi SDK adapter implementing AgentRunner.
 *
 * Wraps the Pi SDK's createAgentSession / session.prompt() flow.
 * All SDK-level failures are caught and returned as typed Err(AgentError) —
 * this class NEVER throws across the AgentRunner boundary (plan §2a, P7).
 *
 * T11 uses this class directly: `new PiAgentRunner()` — no constructor args needed.
 * The steel-thread test injects it alongside makeStubAgent() to run the real model path.
 */
export class PiAgentRunner implements AgentRunner {
  async run(inputs: AgentRunInputs): Promise<Result<AgentRunSuccess, AgentError>> {
    // -----------------------------------------------------------------------
    // 1. Cancellation check (best-effort; full wiring is M4).
    //    Check before constructing any SDK objects so cancelled runs are cheap.
    // -----------------------------------------------------------------------
    if (inputs.signal?.aborted) {
      return Result.err(
        new CancelledError({
          message: "Run was cancelled before it started.",
          cost: { model: inputs.model, durationMs: 0 },
        }),
      );
    }

    // -----------------------------------------------------------------------
    // 2. Model resolution.
    //    inputs.model is optional "provider/id".
    //    Malformed (no slash) → immediate Err, no SDK object constructed.
    //    Well-formed but not found → Err(ModelError).
    //    undefined → leave model unset in createAgentSession (SDK default).
    //    NOTE: M6 routing will replace the undefined path with explicit resolution.
    // -----------------------------------------------------------------------
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);

    let model: ReturnType<typeof modelRegistry.find> | undefined;

    if (inputs.model !== undefined) {
      const slash = inputs.model.indexOf("/");
      if (slash === -1) {
        // Malformed — return immediately, no SDK objects constructed.
        return Result.err(
          new ModelError({
            message: `inputs.model must be "provider/id" (got "${inputs.model}")`,
            cost: { model: inputs.model, durationMs: 0 },
          }),
        );
      }
      const provider = inputs.model.slice(0, slash);
      const id = inputs.model.slice(slash + 1);
      model = modelRegistry.find(provider, id);
      if (!model) {
        return Result.err(
          new ModelError({
            message: `Model not found in registry: "${inputs.model}"`,
            cost: { model: inputs.model, durationMs: 0 },
          }),
        );
      }
    }
    // model === undefined → M6 routing; SDK uses default resolution.

    // -----------------------------------------------------------------------
    // 3. Build the submit_findings tool via SubmitTool (guards 1 & 2).
    // -----------------------------------------------------------------------
    const handler = new SubmitTool(inputs.submitSchema);

    const submitTool = defineTool({
      name: "submit_findings",
      label: "Submit findings",
      description:
        "Submit your FINAL findings verdict. Call this exactly ONCE when you have " +
        "completed your analysis. This is the only way to finish the run. Do NOT call " +
        "it more than once — duplicate calls are silently ignored.",
      parameters: inputs.submitSchema,
      execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
        const result = handler.submit(params);
        return {
          content: [{ type: "text", text: result.message }],
          details: {},
        };
      },
    });

    // -----------------------------------------------------------------------
    // 4. Replace the Pi coding-agent persona with the phase rubric.
    //    systemPromptOverride: () => inputs.rubric wipes the default persona.
    //    appendSystemPromptOverride: () => [] prevents any append additions.
    //    This is the POC pattern — copy exactly.
    // -----------------------------------------------------------------------
    const loader = new DefaultResourceLoader({
      cwd: inputs.cwd,
      agentDir: getAgentDir(),
      systemPromptOverride: () => inputs.rubric,
      appendSystemPromptOverride: () => [],
    });
    await loader.reload();

    // -----------------------------------------------------------------------
    // 5. Run: createAgentSession → subscribe → prompt → dispose.
    //    Wall-clock start for durationMs.
    // -----------------------------------------------------------------------
    const startMs = Date.now();

    // Toolset comes verbatim from inputs — the phase guarantees mutation-free.
    // submit_findings is already in stub-agent's toolset; we forward as-is.
    // We do NOT add extra tools — only what the phase explicitly allows.
    const toolset = inputs.toolset.includes("submit_findings")
      ? inputs.toolset
      : [...inputs.toolset, "submit_findings"];

    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    // Captured inside the try block, before dispose(), while the session is live.
    let cost: AgentRunSuccess["cost"] | undefined;

    try {
      const { session: s } = await createAgentSession({
        cwd: inputs.cwd,
        model,
        thinkingLevel: "medium",
        authStorage,
        modelRegistry,
        resourceLoader: loader,
        tools: toolset,
        customTools: [submitTool],
        sessionManager: SessionManager.inMemory(inputs.cwd),
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: true },
          retry: { enabled: true, maxRetries: 2 },
        }),
      });
      session = s;

      // Subscribe for tool progress events (POC pattern).
      // tool_execution_start is in AgentEvent / AgentSessionEvent.
      session.subscribe((event) => {
        if (event.type === "tool_execution_start") {
          inputs.onTool?.(event.toolName);
        }
      });

      // Best-effort cancellation check before the prompt call.
      // Full AbortSignal wiring (abort mid-turn) is M4; this guard prevents
      // starting a turn that was already cancelled by the scheduler.
      if (inputs.signal?.aborted) {
        const durationMs = Date.now() - startMs;
        return Result.err(
          new CancelledError({
            message: "Run was cancelled before prompting the model.",
            cost: { model: inputs.model, durationMs },
          }),
        );
      }

      await session.prompt(inputs.userPrompt);

      // -----------------------------------------------------------------------
      // 6. Read cost from getSessionStats() — the ground-truth accessor.
      //    Must happen HERE, inside the try block, before the finally disposes
      //    the session. Reading stats post-dispose is order-dependent and could
      //    throw after resource cleanup, violating the never-throws contract (P7).
      //    tokens.input → inputTokens, tokens.output → outputTokens.
      // -----------------------------------------------------------------------
      const durationMs = Date.now() - startMs;
      const stats = session.getSessionStats();
      cost = {
        model: inputs.model,
        inputTokens: stats.tokens.input,
        outputTokens: stats.tokens.output,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;
      // Any SDK/provider error becomes Err(ModelError). Best-effort cost.
      const message = err instanceof Error ? err.message : String(err);
      return Result.err(
        new ModelError({
          message,
          cost: { model: inputs.model, durationMs },
        }),
      );
    } finally {
      session?.dispose();
    }

    // cost is guaranteed assigned here: the catch path returns, so the only
    // way to reach this line is a successful prompt + stats read above.
    // The undefined union is for TypeScript only; it cannot be undefined at runtime.
    /* c8 ignore next 3 */
    if (cost === undefined) {
      cost = { model: inputs.model, durationMs: Date.now() - startMs };
    }

    // -----------------------------------------------------------------------
    // 7. Outcome: guard 3 (no-submit fallback).
    // -----------------------------------------------------------------------
    if (!handler.hasSubmission) {
      return Result.err(
        new NoSubmitError({
          message: "Agent finished without submitting a result.",
          cost,
        }),
      );
    }

    return Result.ok({
      submission: handler.submission,
      cost,
    });
  }
}
