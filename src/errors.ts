import { TaggedError } from "better-result";
import type { Cost } from "./schema/report.js";

/**
 * Scope detection failed — conflicting explicit flags or nothing detectable.
 * Maps to exit 2.
 */
export class ScopeError extends TaggedError("ScopeError")<{
  message: string;
}>() {}

/**
 * Config loading or parsing failed. Carries the file path for actionable output.
 * Maps to exit 2.
 */
export class ConfigError extends TaggedError("ConfigError")<{
  path: string;
  message: string;
}>() {}

/**
 * Tier-to-model resolution failed, either at preflight (exit 2) or per-phase (phase error).
 * `tier` is optional: present when resolution was attempted for a specific tier.
 */
export class RoutingError extends TaggedError("RoutingError")<{
  tier?: string;
  message: string;
}>() {}

/**
 * A safety budget was exceeded. The `limit` names which budget (e.g. "wallClockMs", "turns").
 * Surfaces as a phase-level error outcome, not a process exit.
 */
export class BudgetError extends TaggedError("BudgetError")<{
  limit: string;
  message: string;
}>() {}

/**
 * Runtime validation of a RunReport (or any schema) failed.
 * `errors` carries the first N TypeBox error paths+messages for actionable output.
 * Maps to exit 2.
 */
export class SchemaError extends TaggedError("SchemaError")<{
  message: string;
  errors: ReadonlyArray<{ path: string; message: string }>;
}>() {}

// ---------------------------------------------------------------------------
// Agent runner errors (M2) — runner-level failure union, NOT part of StetError
// ---------------------------------------------------------------------------

/**
 * The agent finished (turn budget exhausted or tool loop ended) without ever calling
 * the submit_findings tool. Carries the cost so the phase wrapper can record it.
 * Maps to a phase-level error outcome, not an exit-2 stet malfunction.
 */
export class NoSubmitError extends TaggedError("NoSubmitError")<{
  message: string;
  cost: Cost;
}>() {}

/**
 * The run was cancelled externally (AbortSignal fired) before the agent submitted.
 * Carries the cost accrued up to cancellation.
 * Maps to a phase-level error outcome.
 */
export class CancelledError extends TaggedError("CancelledError")<{
  message: string;
  cost: Cost;
}>() {}

/**
 * The model/provider returned an unrecoverable error (auth failure, context overflow, etc.).
 * Carries the model identifier and cost accrued before the failure.
 * Maps to a phase-level error outcome.
 */
export class ModelError extends TaggedError("ModelError")<{
  message: string;
  cost: Cost;
}>() {}

/**
 * Runner-level failure union — what AgentRunner.run() returns on Err.
 * These map to phase-level `error` outcomes via the wrapper's exhaustive matchError.
 * They are NOT part of StetError (which is the CLI shell's exit-2 union).
 */
export type AgentError = NoSubmitError | BudgetError | CancelledError | ModelError;

// ---------------------------------------------------------------------------
// Top-level stet error union
// ---------------------------------------------------------------------------

/**
 * Top-level error union for the CLI shell.
 * Every variant maps to exit 2 + a human message in M1.
 * Adding a new variant here is a compile error until the shell's matchError handles it.
 */
export type StetError = ScopeError | ConfigError | RoutingError | BudgetError | SchemaError;
