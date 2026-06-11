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
  createBashToolDefinition,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentToolResult,
  BashOperations,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import { CancelledError, ModelError, NoSubmitError } from "../errors.js";
import type { AgentError } from "../errors.js";
import type { AgentRunInputs, AgentRunSuccess, AgentRunner } from "./runner.js";
import { runBashForSdk, formatCapSize } from "./budgets.js";
import { SUBMIT_TOOL_NAME, SubmitTool } from "./submit-tool.js";

// ---------------------------------------------------------------------------
// Toolset wiring helpers (exported for hermetic coverage — T13 finding #3)
// ---------------------------------------------------------------------------

/**
 * Split the built-in "bash" out of the toolset.
 *
 * T13 replaces the SDK's unrestricted "bash" with a custom, limit-enforcing bash
 * tool. The SDK selects its default shell by the string "bash" in `tools`, so we
 * must remove that string and register our own ToolDefinition via `customTools`.
 *
 * Returns the toolset with "bash" removed and whether it was present. When absent,
 * `tools` is the input unchanged (referential identity preserved for the no-bash path).
 */
export function splitBashFromToolset(toolset: string[]): { tools: string[]; hasBash: boolean } {
  const hasBash = toolset.includes("bash");
  return { tools: hasBash ? toolset.filter((t) => t !== "bash") : toolset, hasBash };
}

/**
 * Build the bash tool description that matches stet's actual caps.
 *
 * The SDK's stock description claims "Output is truncated to last 2000 lines or 50KB…
 * full output is saved to a temp file." — both claims are false when stet's output cap
 * (bashOutputCap bytes) has already capped and marked the output before the SDK sees it.
 * We replace the description with one that states what stet actually delivers.
 *
 * Exported so tests can assert it reflects the configured cap (not the SDK's 2000/50KB text).
 */
export function buildBashToolDescription(bashOutputCapBytes: number): string {
  // Use formatCapSize (exported from budgets.ts) for consistency with the truncation marker
  // that actually appears in the output. Math.round(bytes/1024) renders "0KB" for sub-512-byte
  // caps and disagrees with the marker — formatCapSize handles sub-KB sizes correctly (fix 4).
  const capStr = formatCapSize(bashOutputCapBytes);
  return (
    `Execute a bash command in the current working directory. Returns stdout and stderr. ` +
    `Output is capped at ${capStr} by stet's safety limits; if the cap is hit the output ` +
    `ends with an in-band truncation marker and the process is killed — there is no "full ` +
    `output" temp file. A model-supplied timeout (seconds) is honored up to the budget ceiling.`
  );
}

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
    // 1. Cancellation check (pre-construction guard).
    //    Check before constructing any SDK objects so cancelled runs are cheap.
    //    Full mid-turn abort wiring (Finding #1) is registered after session creation.
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
    //    inputs.model is required: a "provider/id" string resolved by the caller.
    //    All model-string validation runs FIRST (before any SDK object is constructed)
    //    so that the fast-fail paths are truly hermetic.
    //    - undefined → Err(ModelError) immediately, no SDK object constructed.
    //      Pre-M6 the CLI supplies the model from PI_TEST_MODEL; unset ⇒ this error
    //      surfaces as a phase-level error and the deterministic half still runs.
    //      Post-M6 the routing layer resolves a concrete model before calling the
    //      runner, so "undefined reached the runner" is an error in both eras.
    //    - Malformed (no slash) → immediate Err(ModelError), no SDK object constructed.
    //    - Well-formed but not found in registry → Err(ModelError) after registry lookup.
    //    Plan refs: §2a/P10 (pre-M6 stopgap), decision P10 (M6 routing replaces this).
    // -----------------------------------------------------------------------

    // undefined check — no SDK object constructed on this path.
    if (inputs.model === undefined) {
      return Result.err(
        new ModelError({
          message:
            "no model available — set PI_TEST_MODEL (pre-M6 stopgap) or configure model routing (M6)",
          cost: { model: undefined, durationMs: 0 },
        }),
      );
    }

    // Malformed (no slash) — no SDK object constructed on this path.
    if (inputs.model.indexOf("/") === -1) {
      return Result.err(
        new ModelError({
          message: `inputs.model must be "provider/id" (got "${inputs.model}")`,
          cost: { model: inputs.model, durationMs: 0 },
        }),
      );
    }

    // Model string is well-formed: construct SDK objects and resolve from registry.
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);

    const slash = inputs.model.indexOf("/");
    const provider = inputs.model.slice(0, slash);
    const id = inputs.model.slice(slash + 1);
    const model = modelRegistry.find(provider, id);
    if (!model) {
      return Result.err(
        new ModelError({
          message: `Model not found in registry: "${inputs.model}"`,
          cost: { model: inputs.model, durationMs: 0 },
        }),
      );
    }

    // -----------------------------------------------------------------------
    // 3. Build the submit_findings tool via SubmitTool (guards 1 & 2).
    // -----------------------------------------------------------------------
    const handler = new SubmitTool(inputs.submitSchema);

    const submitTool = defineTool({
      name: SUBMIT_TOOL_NAME,
      label: "Submit findings",
      description:
        "Submit your FINAL findings verdict. Call this exactly ONCE when you have " +
        "completed your analysis. This is the only way to finish the run. Do NOT call " +
        "it more than once — duplicate calls are silently ignored.",
      parameters: inputs.submitSchema,
      // Five-arg execute signature required by ToolDefinition<TParams, TDetails, TState>.
      // signal + onUpdate + ctx are unused here; _ prefix documents that intentionally.
      execute: async (
        _toolCallId: string,
        params: unknown,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        _ctx: unknown,
      ): Promise<AgentToolResult<unknown>> => {
        const result = handler.submit(params);
        // terminate: true once a valid submission is captured — signals the SDK to stop the
        // agent after the current tool batch (AgentToolResult.terminate semantics: early
        // termination happens only when every finalized result in the batch sets this true).
        // On invalid submissions (guard 1) or duplicates (guard 2) hasSubmission is false/
        // still-true respectively; terminate: false on guard-1 lets the model retry.
        return {
          content: [{ type: "text", text: result.message }],
          details: {},
          terminate: handler.hasSubmission,
        };
      },
    });

    // -----------------------------------------------------------------------
    // 4. Run: createAgentSession → subscribe → prompt → dispose.
    //    Wall-clock start for durationMs. Loader construction and reload are
    //    inside the try block so filesystem I/O errors are caught and returned
    //    as Err(ModelError), preserving the "run() never rejects" contract (P7).
    // -----------------------------------------------------------------------
    const startMs = Date.now();

    // inputs.toolset is forwarded verbatim (mutation-free, phase-owned).
    // SUBMIT_TOOL_NAME is ensured present as the single completion tool —
    // a safety net in case a phase omits it, but stub-agent already includes it.
    const toolsetWithSubmit = inputs.toolset.includes(SUBMIT_TOOL_NAME)
      ? inputs.toolset
      : [...inputs.toolset, SUBMIT_TOOL_NAME];

    // T13: replace the built-in "bash" with a custom bash tool that enforces
    // the per-call timeout and output cap from inputs.budgets (PRD §3.5, plan §2a/T13).
    // The string "bash" selects the SDK's default shell (no limits); our custom tool
    // delegates to runBashForSdk() which kills on timeout/cap and surfaces those breaches
    // in-band (timeout → "timeout:N" throw, cap → marker in output) so a killed command
    // is never reported to the model as a clean success.
    const { tools: toolset, hasBash } = splitBashFromToolset(toolsetWithSubmit);

    const bashOps: BashOperations = {
      exec: (command, cwd, options) => runBashForSdk(command, cwd, options, inputs.budgets),
    };
    // Cast needed: createBashToolDefinition returns a more-specific ToolDefinition
    // generic than the base ToolDefinition<TSchema, unknown, any> that customTools expects.
    //
    // Finding #2 (stacked/contradictory truncation layers): override the SDK's stock description
    // which falsely claims "full output is saved to a temp file" — when stet's cap fires, the
    // "full output" temp file only contains capped data, making the pointer misleading. We spread
    // the returned definition and replace `description` with one that states stet's actual behavior.
    // `BashToolOptions` has no truncation-limit knobs (no maxLines/maxBytes), so description
    // override is the only available alignment point.
    const bashToolDef: ToolDefinition | null = hasBash
      ? ({
          ...createBashToolDefinition(inputs.cwd, { operations: bashOps }),
          description: buildBashToolDescription(inputs.budgets.bashOutputCap),
        } as ToolDefinition)
      : null;

    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    // Captured inside the try block, before dispose(), while the session is live.
    let cost: AgentRunSuccess["cost"] | undefined;
    // Abort listener wired to session.abort() after the session is created (Finding #1).
    // Stored here so the finally block can remove it — the signal outlives the run,
    // and a leaked listener accumulates across runs.
    let abortListener: (() => void) | undefined;

    try {
      // -----------------------------------------------------------------------
      // 4a. Replace the Pi coding-agent persona with the phase rubric.
      //     systemPromptOverride: () => inputs.rubric wipes the default persona.
      //     appendSystemPromptOverride: () => [] prevents any append additions.
      //     This is the POC pattern — copy exactly.
      //     Constructed and reloaded here (inside try) so any filesystem I/O
      //     failure is caught by the block below and returned as Err(ModelError).
      // -----------------------------------------------------------------------
      const loader = new DefaultResourceLoader({
        cwd: inputs.cwd,
        agentDir: getAgentDir(),
        systemPromptOverride: () => inputs.rubric,
        appendSystemPromptOverride: () => [],
      });
      await loader.reload();

      // -----------------------------------------------------------------------
      // 4b. Create session, subscribe, prompt, read stats.
      // -----------------------------------------------------------------------
      const { session: s } = await createAgentSession({
        cwd: inputs.cwd,
        model,
        thinkingLevel: "medium",
        authStorage,
        modelRegistry,
        resourceLoader: loader,
        tools: toolset,
        customTools: [submitTool, ...(bashToolDef ? [bashToolDef] : [])],
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

      // -----------------------------------------------------------------------
      // Finding #1: wire AbortSignal → session.abort() so the session actually
      // stops when the wall-clock controller fires (not just the pre-prompt guards).
      //
      // session.abort() is async (returns Promise<void>): aborts the current
      // operation and waits for the agent to become idle. We call it fire-and-forget
      // from the listener — the goal is to interrupt the in-progress prompt(), not
      // to await completion here. session.prompt() will resolve (or reject) on its
      // own once the session becomes idle.
      //
      // { once: true } ensures the listener self-removes after the first fire.
      // We also track it in abortListener for removal in finally, since the signal
      // outlives the run and a listener that fires after dispose() would be a no-op
      // but would accumulate across runs.
      // -----------------------------------------------------------------------
      if (inputs.signal) {
        // Pre-aborted: skip the prompt entirely — same path as the line-263 guard.
        if (inputs.signal.aborted) {
          const durationMs = Date.now() - startMs;
          return Result.err(
            new CancelledError({
              message: "Run was cancelled before prompting the model.",
              cost: { model: inputs.model, durationMs },
            }),
          );
        }
        // Register the live abort listener.
        abortListener = () => {
          session?.abort().catch(() => {
            /* abort() rejection must not surface — session may already be disposed */
          });
        };
        inputs.signal.addEventListener("abort", abortListener, { once: true });
      }

      await session.prompt(inputs.userPrompt);

      // -----------------------------------------------------------------------
      // 5b. Post-prompt abort check (fix 5: abort-then-prompt-resolves).
      //
      // Verified SDK behavior: session.abort() makes prompt() RESOLVE cleanly
      // (stopReason "aborted"; pi-agent-core runWithLifecycle never rethrows).
      // A mid-turn wall-clock abort therefore falls through to the stats read below
      // and returns Err(NoSubmitError) instead of Err(CancelledError).
      //
      // A valid submission still wins (checked first in step 7 below), so we only
      // apply this path when there is no submission yet.
      // -----------------------------------------------------------------------
      if (inputs.signal?.aborted && !handler.hasSubmission) {
        const durationMs = Date.now() - startMs;
        return Result.err(
          new CancelledError({
            message: "Run was cancelled by the wall-clock budget.",
            cost: { model: inputs.model, durationMs },
          }),
        );
      }

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
      // If the model already made a valid submission before the error
      // (e.g. a rate-limit thrown after submit_findings was called, or the wall-clock
      // abort fires mid-turn but a submission was already captured), honour "first valid
      // submission wins" and return the captured result rather than discarding it.
      // Cost is best-effort: durationMs + model are reliable; token stats may be
      // unreadable after the throw, so we omit them on this path.
      if (handler.hasSubmission) {
        return Result.ok({
          submission: handler.submission,
          cost: { model: inputs.model, durationMs },
        });
      }
      // Finding #1: if the signal is aborted and there is no valid submission, this is a
      // wall-clock cancellation — not a provider error. Return Err(CancelledError) so the
      // phase wrapper records it as a cancellation rather than misreporting it as a model
      // failure. The catch here fires because session.abort() interrupts prompt() and the
      // SDK surfaces the abort as an Error.
      if (inputs.signal?.aborted) {
        return Result.err(
          new CancelledError({
            message: "Run was cancelled by the wall-clock budget.",
            cost: { model: inputs.model, durationMs },
          }),
        );
      }
      // No prior valid submission, no abort signal — surface the provider error.
      const message = err instanceof Error ? err.message : String(err);
      return Result.err(
        new ModelError({
          message,
          cost: { model: inputs.model, durationMs },
        }),
      );
    } finally {
      // Remove the abort listener (signal outlives the run; leaked listeners accumulate).
      if (inputs.signal && abortListener) {
        inputs.signal.removeEventListener("abort", abortListener);
      }
      // Wrap dispose() so a throw there never supersedes the computed Result (P7).
      // AgentSession.dispose() calls cleanupSessionResources() outside its own try/catch
      // and can throw AggregateError — a throw in finally would replace the return above.
      try {
        session?.dispose();
      } catch {
        /* dispose failures must never mask the run's Result */
      }
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
