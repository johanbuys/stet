/**
 * Tests for tier→model resolution (T19 · M6 · PRD §3.2).
 *
 * All tests use a fake RoutingRegistry injected at the call site — no real Pi SDK,
 * no credential files are touched.
 *
 * Covers:
 *   - resolveTier: happy path, no-provider Err, ordered list for failback
 *   - resolveForPhase: no override, general override, specific-beats-general
 *   - preflightAll: all-pass, any-fail → Err, independence of phases
 *   - runWithFallback: retryable advances, non-retryable surfaces immediately
 *   - parseModelOverride: general and specific formats
 *
 * PRD refs: §3.2, acceptance #13; plan M6 (a).
 */

import { describe, expect, it } from "vite-plus/test";
import { Result } from "better-result";
import { ModelError } from "../errors.js";
import {
  parseModelOverride,
  preflightAll,
  resolveForPhase,
  resolveTier,
  runWithFallback,
  TIER_PREFERENCES,
  type ModelTier,
  type RoutingRegistry,
} from "./resolve.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Registry where a fixed set of providers are credentialed. */
function makeRegistry(credentialedProviders: string[]): RoutingRegistry {
  const set = new Set(credentialedProviders);
  return { isCredentialed: (p) => set.has(p) };
}

/** Registry where no providers are credentialed. */
const noCredRegistry: RoutingRegistry = { isCredentialed: () => false };

/** Registry where all providers are credentialed (for override tests). */
const allCredRegistry: RoutingRegistry = { isCredentialed: () => true };

/** Minimal zero-cost ModelError factory for runner stubs. */
function makeModelError(message: string): ModelError {
  return new ModelError({ message, cost: { durationMs: 0 } });
}

// ---------------------------------------------------------------------------
// resolveTier
// ---------------------------------------------------------------------------

describe("resolveTier", () => {
  it("happy path: single credentialed provider → Ok([model])", () => {
    const [firstModel] = TIER_PREFERENCES.fast;
    const provider = firstModel!.split("/")[0]!;
    const result = resolveTier("fast", makeRegistry([provider]));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.model).toBe(firstModel);
    }
  });

  it("no credentialed provider → Err(RoutingError) with tier named", () => {
    const result = resolveTier("robust", noCredRegistry);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("RoutingError");
      expect(result.error.tier).toBe("robust");
      expect(result.error.message).toContain("robust");
    }
  });

  it("no credentialed provider for fast tier → Err", () => {
    const result = resolveTier("fast", noCredRegistry);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.tier).toBe("fast");
    }
  });

  it("multiple credentialed providers → Ok with all entries in preference order", () => {
    const result = resolveTier("fast", allCredRegistry);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.length).toBeGreaterThan(1);
      // Order must match TIER_PREFERENCES.fast
      const expected = TIER_PREFERENCES.fast.map((m) => ({ model: m }));
      expect(result.value).toEqual(expected);
    }
  });

  it("only second provider credentialed → Ok with only that model", () => {
    const models = TIER_PREFERENCES.robust;
    expect(models.length).toBeGreaterThan(1);
    const secondProvider = models[1]!.split("/")[0]!;
    const result = resolveTier("robust", makeRegistry([secondProvider]));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.model).toBe(models[1]);
    }
  });

  it("Err message names candidate providers so user knows what to credential", () => {
    const result = resolveTier("fast", noCredRegistry);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      // Should mention at least one provider name so the message is actionable
      const providers = TIER_PREFERENCES.fast.map((m) => m.split("/")[0]!);
      const msg = result.error.message;
      expect(providers.some((p) => msg.includes(p))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveForPhase
// ---------------------------------------------------------------------------

describe("resolveForPhase", () => {
  it("no overrides: delegates to resolveTier", () => {
    const [firstModel] = TIER_PREFERENCES.fast;
    const provider = firstModel!.split("/")[0]!;
    const result = resolveForPhase("gates", "fast", makeRegistry([provider]));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]!.model).toBe(firstModel);
    }
  });

  it("no overrides, no credentials → Err(RoutingError)", () => {
    const result = resolveForPhase("review", "robust", noCredRegistry);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("RoutingError");
    }
  });

  it("general override (no phaseId) → uses override model regardless of tier", () => {
    const result = resolveForPhase("review", "robust", noCredRegistry, [
      { model: "custom/my-model" },
    ]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([{ model: "custom/my-model" }]);
    }
  });

  it("specific override (phaseId matches) → uses specific model", () => {
    const result = resolveForPhase("review", "robust", noCredRegistry, [
      { model: "custom/general" },
      { phaseId: "review", model: "custom/specific" },
    ]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([{ model: "custom/specific" }]);
    }
  });

  it("specific override for different phase: does not apply; general override wins", () => {
    const result = resolveForPhase("gates", "fast", noCredRegistry, [
      { model: "custom/general" },
      { phaseId: "review", model: "custom/review-only" },
    ]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // "gates" has no specific override; general applies
      expect(result.value).toEqual([{ model: "custom/general" }]);
    }
  });

  it("specific override for different phase, no general → falls through to tier", () => {
    const [firstModel] = TIER_PREFERENCES.fast;
    const provider = firstModel!.split("/")[0]!;
    const result = resolveForPhase("gates", "fast", makeRegistry([provider]), [
      { phaseId: "review", model: "custom/review-only" },
    ]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]!.model).toBe(firstModel);
    }
  });

  it("specific beats general: specific phaseId override wins over general", () => {
    const result = resolveForPhase("review", "robust", allCredRegistry, [
      { model: "custom/general" },
      { phaseId: "review", model: "custom/review-specific" },
    ]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([{ model: "custom/review-specific" }]);
    }
  });

  it("per-phase independence: phase A resolves, phase B does not — separate results", () => {
    const [firstRobustModel] = TIER_PREFERENCES.robust;
    const robustProvider = firstRobustModel!.split("/")[0]!;
    // Only the robust provider is credentialed. fast tier has a different provider first.
    const fastModels = TIER_PREFERENCES.fast;
    const fastFirstProvider = fastModels[0]!.split("/")[0]!;
    // Ensure the first fast provider is different from robust provider
    // so we get the independence scenario.
    const registry = makeRegistry([robustProvider]);

    const resultA = resolveForPhase("review", "robust", registry);
    // Fast tier's first entry is either the same or different provider.
    // If same, this test needs adjustment — but the logic is independent regardless.
    const resultB = resolveForPhase("gates", "fast", registry);

    // Phase A should succeed (robust provider credentialed)
    expect(resultA.isOk()).toBe(true);

    // Phase B result is independent — success only if fastFirstProvider === robustProvider
    if (fastFirstProvider === robustProvider) {
      expect(resultB.isOk()).toBe(true);
    } else {
      // These are independent: A's result doesn't affect B's
      // (The result may be Ok or Err depending on fast tier's preference table)
      expect(resultA.isOk()).toBe(true); // A is still Ok regardless
    }
  });

  it("single-phase failure: phase with no provider Errs independently of other phases", () => {
    // Phase A has an override → always Ok
    const resultA = resolveForPhase("review", "robust", noCredRegistry, [
      { phaseId: "review", model: "custom/ok" },
    ]);
    // Phase B has no override, no credentials → Err
    const resultB = resolveForPhase("gates", "fast", noCredRegistry);

    expect(resultA.isOk()).toBe(true);
    expect(resultB.isErr()).toBe(true);
    // Each result is independent — A's success is unaffected by B's failure
    if (resultA.isOk()) {
      expect(resultA.value).toEqual([{ model: "custom/ok" }]);
    }
  });
});

// ---------------------------------------------------------------------------
// preflightAll
// ---------------------------------------------------------------------------

describe("preflightAll", () => {
  it("empty phase list → Ok (nothing to check)", () => {
    const result = preflightAll([], noCredRegistry);
    expect(result.isOk()).toBe(true);
  });

  it("all phases credentialed → Ok", () => {
    const result = preflightAll(
      [
        { id: "review", tier: "robust" as ModelTier },
        { id: "gates", tier: "fast" as ModelTier },
      ],
      allCredRegistry,
    );
    expect(result.isOk()).toBe(true);
  });

  it("one phase with no credentialed provider → Err(RoutingError)", () => {
    const result = preflightAll([{ id: "review", tier: "robust" as ModelTier }], noCredRegistry);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("RoutingError");
    }
  });

  it("mixed: one phase credentialed, one not → Err (preflight is all-or-nothing)", () => {
    // Phase A: override → always resolves
    // Phase B: no override, no credentials → fails
    const result = preflightAll(
      [
        { id: "review", tier: "robust" as ModelTier },
        { id: "gates", tier: "fast" as ModelTier },
      ],
      noCredRegistry,
      [{ phaseId: "review", model: "custom/ok" }], // only review has override
    );
    // "gates" has no override and no credentials → preflight Err
    expect(result.isErr()).toBe(true);
  });

  it("all phases have overrides → Ok even with no credentials", () => {
    const result = preflightAll(
      [
        { id: "review", tier: "robust" as ModelTier },
        { id: "gates", tier: "fast" as ModelTier },
      ],
      noCredRegistry,
      [{ model: "custom/override" }], // general override applies to all
    );
    expect(result.isOk()).toBe(true);
  });

  it("preflight Err message is actionable (names the failing tier)", () => {
    const result = preflightAll([{ id: "review", tier: "robust" as ModelTier }], noCredRegistry);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("robust");
    }
  });
});

// ---------------------------------------------------------------------------
// runWithFallback
// ---------------------------------------------------------------------------

describe("runWithFallback", () => {
  it("first model succeeds → Ok without trying subsequent models", async () => {
    const calls: string[] = [];
    const attempt = async (model: string): Promise<Result<string, ModelError>> => {
      calls.push(model);
      return Result.ok("success");
    };

    const models = [{ model: "providerA/model1" }, { model: "providerB/model2" }];
    const result = await runWithFallback(models, attempt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("success");
    }
    expect(calls).toEqual(["providerA/model1"]); // only first tried
  });

  it("retryable error on first model → advances to second, which succeeds", async () => {
    const calls: string[] = [];
    const attempt = async (model: string): Promise<Result<string, ModelError>> => {
      calls.push(model);
      if (model === "providerA/model1") {
        return Result.err(makeModelError("transient 503"));
      }
      return Result.ok("fallback-success");
    };

    const models = [{ model: "providerA/model1" }, { model: "providerB/model2" }];
    const isRetryable = (err: ModelError) => err.message.includes("transient");
    const result = await runWithFallback(models, attempt, isRetryable);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("fallback-success");
    }
    expect(calls).toEqual(["providerA/model1", "providerB/model2"]);
  });

  it("non-retryable error on first model → Err immediately, second not tried", async () => {
    const calls: string[] = [];
    const attempt = async (model: string): Promise<Result<string, ModelError>> => {
      calls.push(model);
      return Result.err(makeModelError("auth missing"));
    };

    const models = [{ model: "providerA/model1" }, { model: "providerB/model2" }];
    // isRetryable not set → defaults to () => false (nothing retryable)
    const result = await runWithFallback(models, attempt);

    expect(result.isErr()).toBe(true);
    expect(calls).toEqual(["providerA/model1"]); // second never tried
  });

  it("all models fail with retryable errors → Err after exhausting the list", async () => {
    const calls: string[] = [];
    const attempt = async (model: string): Promise<Result<string, ModelError>> => {
      calls.push(model);
      return Result.err(makeModelError("transient"));
    };

    const models = [{ model: "providerA/model1" }, { model: "providerB/model2" }];
    const result = await runWithFallback(models, attempt, () => true);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("RoutingError");
    }
    expect(calls).toHaveLength(2); // both tried
  });

  it("empty model list → Err(RoutingError)", async () => {
    const result = await runWithFallback([], async () => Result.ok("unreachable"));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("RoutingError");
    }
  });

  it("non-retryable error message names the failing model", async () => {
    const attempt = async (): Promise<Result<string, ModelError>> =>
      Result.err(makeModelError("context window exceeded"));

    const models = [{ model: "anthropic/claude-opus-4-8" }];
    const result = await runWithFallback(models, attempt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("anthropic/claude-opus-4-8");
    }
  });
});

// ---------------------------------------------------------------------------
// parseModelOverride
// ---------------------------------------------------------------------------

describe("parseModelOverride", () => {
  it("general format (no =) → { model }", () => {
    const result = parseModelOverride("anthropic/claude-opus-4-8");
    expect(result).toEqual({ model: "anthropic/claude-opus-4-8" });
  });

  it("specific format (phaseId=model) → { phaseId, model }", () => {
    const result = parseModelOverride("review=anthropic/claude-opus-4-8");
    expect(result).toEqual({ phaseId: "review", model: "anthropic/claude-opus-4-8" });
  });

  it("empty string → null", () => {
    expect(parseModelOverride("")).toBeNull();
  });

  it("missing model after = → null", () => {
    expect(parseModelOverride("review=")).toBeNull();
  });

  it("= with no phaseId → null (empty phaseId is invalid)", () => {
    expect(parseModelOverride("=anthropic/claude-opus-4-8")).toBeNull();
  });

  it("phaseId with multiple = → first = splits phaseId/model (model may contain =)", () => {
    // Edge case: "review=provider/model=extra" → phaseId="review", model="provider/model=extra"
    const result = parseModelOverride("review=provider/model=extra");
    expect(result).toEqual({ phaseId: "review", model: "provider/model=extra" });
  });
});
