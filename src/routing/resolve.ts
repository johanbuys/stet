/**
 * Tier→model resolution (M6 / T19 · PRD §3.2, acceptance #13).
 *
 * Resolution uses an injected RoutingRegistry seam so tests stay hermetic —
 * no real Pi SDK or credential files are touched. The real implementation
 * wraps the SDK's AuthStorage + ModelRegistry behind this interface.
 *
 * Pipeline (PRD §3.2):
 *   1. --model [<phase>=]<id> override wins (specific beats general)
 *   2. Walk the tier's provider preference table; keep credentialed entries
 *   3. Empty result → Err(RoutingError) with an actionable message
 *
 * Resolution returns ResolvedModel[] (ordered preference list) for failback:
 *   - On a retryable provider error the runner advances to the next entry.
 *   - On a non-retryable error the runner surfaces immediately.
 *
 * Preflight: preflightAll() checks ALL phases before any phase launches.
 *   No credentialed provider for any tier → Err(RoutingError) → exit 2.
 */

import { Result } from "better-result";
import { RoutingError } from "../errors.js";
import type { ModelError } from "../errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Capability tier — the config-facing abstraction over concrete model IDs. */
export type ModelTier = "robust" | "fast";

/** A concrete model resolved from a tier. */
export interface ResolvedModel {
  /** Fully-qualified "provider/model-id" string, e.g. "anthropic/claude-opus-4-8". */
  model: string;
}

/**
 * Injected seam over the provider credential store.
 * Real implementation wraps the Pi SDK's AuthStorage + ModelRegistry.
 * Tests use a plain object literal.
 *
 * Engineering note: Pi SDK provider names follow the registry's convention
 * (e.g. "openai-codex", "opencode-go") — not bare "openai"/"anthropic". The
 * real RoutingRegistry adapter must align TIER_PREFERENCES provider names with
 * the SDK's actual provider names. See docs/engineering-notes.md §"Model resolution".
 */
export interface RoutingRegistry {
  /** True iff credentials for the named provider are available. */
  isCredentialed(provider: string): boolean;
}

/** A model override parsed from --model [<phase>=]<id>. */
export interface ModelOverride {
  /** Specific phase this override applies to; undefined = all agent phases. */
  phaseId?: string;
  /** Fully-qualified "provider/model-id". */
  model: string;
}

// ---------------------------------------------------------------------------
// Preference tables
// ---------------------------------------------------------------------------

/** Extract the provider portion from a "provider/model-id" string. */
function providerOf(model: string): string {
  return model.split("/")[0] ?? model;
}

/**
 * Built-in tier → model preference table.
 * Ordered by preference: first credentialed entry wins for resolution.
 * Models are "provider/model-id" strings; the provider portion drives the credential check.
 *
 * PRD §3.2: "tiers resolved at run time against the providers the user actually has credentials
 * for … via a shipped per-provider preference table."
 */
export const TIER_PREFERENCES: Record<ModelTier, string[]> = {
  robust: ["anthropic/claude-opus-4-8", "openai/gpt-4o"],
  fast: ["anthropic/claude-haiku-4-5", "openai/gpt-4o-mini"],
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all credentialed models for a tier, in preference order.
 *
 * Returns every credentialed entry from TIER_PREFERENCES[tier] so the runner
 * can advance through the list on a retryable provider error (failback, PRD §3.2).
 *
 * Err(RoutingError) when no credentialed provider satisfies the tier.
 */
export function resolveTier(
  tier: ModelTier,
  registry: RoutingRegistry,
): Result<ResolvedModel[], RoutingError> {
  const preferences = TIER_PREFERENCES[tier];
  const resolved = preferences
    .filter((model) => registry.isCredentialed(providerOf(model)))
    .map((model): ResolvedModel => ({ model }));

  if (resolved.length === 0) {
    const providers = [...new Set(preferences.map(providerOf))].join(", ");
    return Result.err(
      new RoutingError({
        tier,
        message: `No credentialed provider found for tier "${tier}". Credential one of: ${providers}.`,
      }),
    );
  }

  return Result.ok(resolved);
}

/**
 * Resolve models for a specific phase, applying model overrides if present.
 *
 * Override priority (PRD §3.2): specific (phaseId match) > general (no phaseId) > tier.
 * The returned list is single-entry for overrides (overrides are pinned, no failback needed).
 */
export function resolveForPhase(
  phaseId: string,
  tier: ModelTier,
  registry: RoutingRegistry,
  overrides?: ModelOverride[],
): Result<ResolvedModel[], RoutingError> {
  if (overrides !== undefined && overrides.length > 0) {
    const specific = overrides.find((o) => o.phaseId === phaseId);
    if (specific !== undefined) return Result.ok([{ model: specific.model }]);
    const general = overrides.find((o) => o.phaseId === undefined);
    if (general !== undefined) return Result.ok([{ model: general.model }]);
  }
  return resolveTier(tier, registry);
}

/**
 * Preflight check: every phase must have at least one credentialed model.
 *
 * Called before any phase launches (PRD §3.2, acceptance #13). Err(RoutingError)
 * when any phase can't resolve — the CLI shell maps this to exit 2 via the StetError
 * union (RoutingError is already in StetError; resolveExit handles it).
 */
export function preflightAll(
  phases: ReadonlyArray<{ id: string; tier: ModelTier }>,
  registry: RoutingRegistry,
  overrides?: ModelOverride[],
): Result<void, RoutingError> {
  for (const phase of phases) {
    const result = resolveForPhase(phase.id, phase.tier, registry, overrides);
    if (result.isErr()) return Result.err(result.error);
  }
  return Result.ok(undefined);
}

// ---------------------------------------------------------------------------
// Failback
// ---------------------------------------------------------------------------

/**
 * Try each model in the ordered list until one succeeds or all fail.
 *
 * On a retryable error, advances to the next model (failback, PRD §3.2, decision #27).
 * On a non-retryable error, surfaces immediately without trying further models.
 *
 * `isRetryable` defaults to `() => false` (conservative: nothing is retried unless the
 * caller explicitly marks it as retryable). Pass a provider-specific predicate — e.g.
 * `err => err.message.includes("5xx")` — for production use.
 *
 * Err(RoutingError) when the list is empty or all models fail with retryable errors.
 */
export async function runWithFallback<T>(
  models: ResolvedModel[],
  attempt: (model: string) => Promise<Result<T, ModelError>>,
  isRetryable: (err: ModelError) => boolean = () => false,
): Promise<Result<T, RoutingError>> {
  if (models.length === 0) {
    return Result.err(new RoutingError({ message: "No models available for failback." }));
  }

  for (const resolved of models) {
    const result = await attempt(resolved.model);
    if (result.isOk()) return Result.ok(result.value);
    if (!isRetryable(result.error)) {
      return Result.err(
        new RoutingError({
          message: `Model "${resolved.model}" failed (non-retryable): ${result.error.message}`,
        }),
      );
    }
    // Retryable: advance to the next model in the preference list.
  }

  return Result.err(
    new RoutingError({ message: `All ${models.length} model(s) failed with retryable errors.` }),
  );
}

// ---------------------------------------------------------------------------
// Override parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single --model argument into a ModelOverride.
 *
 * Formats:
 *   provider/id          → general override (applies to all agent phases)
 *   <phase>=provider/id  → specific override (applies only to named phase)
 *
 * Returns null when the argument is malformed (caller may emit Err(ConfigError)).
 * The first "=" splits phaseId from model, so "review=provider/model=extra" parses
 * correctly as { phaseId: "review", model: "provider/model=extra" }.
 */
export function parseModelOverride(arg: string): ModelOverride | null {
  if (arg.length === 0) return null;
  const eqIdx = arg.indexOf("=");
  if (eqIdx === -1) {
    return { model: arg };
  }
  const phaseId = arg.slice(0, eqIdx);
  const model = arg.slice(eqIdx + 1);
  if (phaseId.length === 0 || model.length === 0) return null;
  return { phaseId, model };
}
