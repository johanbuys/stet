import { TaggedError } from "better-result";

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
 * Top-level error union for the CLI shell.
 * Every variant maps to exit 2 + a human message in M1.
 * Adding a new variant here is a compile error until the shell's matchError handles it.
 */
export type StetError = ScopeError | ConfigError | RoutingError | BudgetError;
