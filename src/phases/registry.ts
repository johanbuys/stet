/**
 * Phase registry — the central store for registered PhaseConfiguration values.
 *
 * Design: an internal Map keyed by id; registration order is preserved as an insertion-order
 * key sequence. Registering a duplicate id **replaces** the existing entry in-place (the
 * original insertion position is kept so the display/execution order remains stable).
 * This lets a test or integration scenario override a phase without disturbing ordering.
 *
 * Public API:
 *   registerPhase(config)   — add or replace a phase
 *   registeredPhases()      — snapshot of all phases in registration order
 *   resetRegistry()         — ONLY for tests: wipe all registrations
 *
 * PRD §4.1 acceptance #1: "adding a sixth phase touches no harness code" —
 * a new phase registers itself here and appears in the default set via `src/phases/index.ts`.
 * No harness code (scheduler, reporter, …) needs to change.
 */

import type { PhaseConfiguration } from "./types.js";

// Internal registry: Map preserves insertion order, giving us O(1) lookup + stable ordering.
const registry = new Map<string, PhaseConfiguration>();

/**
 * Register a phase. If a phase with the same id is already registered, it is replaced
 * in-place (original insertion position preserved, so ordering remains stable).
 *
 * Rationale for replace-not-reject: the steel-thread test registers stub phases explicitly
 * (plan §2, P10) without caring whether they were already in the default set; replacing is
 * the only behavior that makes that safe. A collision that's truly a bug surfaces at the
 * "two different configs claim the same id" layer, which is a config-loading concern (M5).
 */
export function registerPhase(config: PhaseConfiguration): void {
  registry.set(config.id, config);
}

/**
 * Return all registered phases in registration order.
 * Returns a **snapshot** (shallow copy of the Map values) — mutating the returned array
 * does not affect the registry.
 */
export function registeredPhases(): PhaseConfiguration[] {
  return [...registry.values()];
}

/**
 * Reset the registry to an empty state.
 *
 * @internal TEST-ONLY. Call in afterEach/beforeEach to avoid state bleeding between tests.
 * Not intended for production use — the registry is populated once at startup.
 */
export function resetRegistry(): void {
  registry.clear();
}
