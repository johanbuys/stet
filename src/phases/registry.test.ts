/**
 * Tests for the phase registry.
 *
 * Covers: register adds; duplicate-id replaces (documented behavior); registration order
 * preserved in registeredPhases(); resetRegistry() clears for test isolation.
 */

import { afterEach, describe, expect, test } from "vite-plus/test";
import type { PhaseConfiguration } from "./types.js";
import { registerPhase, registeredPhases, resetRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePhase(id: string): PhaseConfiguration {
  return {
    id,
    kind: "deterministic",
    activation: () => true,
    run: async () => ({
      phase: id,
      status: "completed",
      findings: [],
      audit: {},
      cost: { durationMs: 0 },
    }),
  };
}

// Always reset between tests so registry state doesn't bleed
afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("registerPhase", () => {
  test("registers a phase — registeredPhases() returns it", () => {
    const phase = makePhase("stub-det");
    registerPhase(phase);
    const phases = registeredPhases();
    expect(phases).toHaveLength(1);
    expect(phases[0]?.id).toBe("stub-det");
  });

  test("registering multiple phases returns all of them", () => {
    registerPhase(makePhase("stub-det"));
    registerPhase(makePhase("stub-agent"));
    const phases = registeredPhases();
    expect(phases).toHaveLength(2);
    expect(phases.map((p) => p.id)).toEqual(["stub-det", "stub-agent"]);
  });

  test("registration order is preserved (first registered first in the array)", () => {
    registerPhase(makePhase("alpha"));
    registerPhase(makePhase("beta"));
    registerPhase(makePhase("gamma"));
    const ids = registeredPhases().map((p) => p.id);
    expect(ids).toEqual(["alpha", "beta", "gamma"]);
  });
});

// ---------------------------------------------------------------------------
// Duplicate-id behavior: last registration wins (replaces)
// ---------------------------------------------------------------------------

describe("registerPhase — duplicate id replaces (last wins)", () => {
  test("registering the same id twice replaces the earlier entry", () => {
    const first = makePhase("stub-det");
    const second = makePhase("stub-det");
    registerPhase(first);
    registerPhase(second);
    const phases = registeredPhases();
    // Must have exactly one entry with this id
    expect(phases).toHaveLength(1);
    expect(phases[0]).toBe(second);
  });

  test("replacement preserves insertion position of the first registration", () => {
    // alpha registered first, then beta, then alpha again.
    // Result should be [alpha-v2, beta] — alpha's position is the *original* slot.
    const alpha1 = makePhase("alpha");
    const beta = makePhase("beta");
    const alpha2 = makePhase("alpha");
    registerPhase(alpha1);
    registerPhase(beta);
    registerPhase(alpha2);
    const phases = registeredPhases();
    expect(phases).toHaveLength(2);
    expect(phases[0]?.id).toBe("alpha");
    expect(phases[0]).toBe(alpha2); // the replacement
    expect(phases[1]?.id).toBe("beta");
  });
});

// ---------------------------------------------------------------------------
// registeredPhases() returns a snapshot (not the live internal array)
// ---------------------------------------------------------------------------

describe("registeredPhases", () => {
  test("returns an independent snapshot — mutating the returned array does not affect the registry", () => {
    registerPhase(makePhase("stub-det"));
    const phases = registeredPhases();
    // Mutate the returned array
    phases.push(makePhase("extra"));
    // Registry must be unchanged
    expect(registeredPhases()).toHaveLength(1);
  });

  test("returns empty array when nothing is registered", () => {
    expect(registeredPhases()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resetRegistry (test-only)
// ---------------------------------------------------------------------------

describe("resetRegistry (test-only)", () => {
  test("clears all registered phases", () => {
    registerPhase(makePhase("stub-det"));
    registerPhase(makePhase("stub-agent"));
    expect(registeredPhases()).toHaveLength(2);
    resetRegistry();
    expect(registeredPhases()).toHaveLength(0);
  });

  test("phases registered after reset are visible", () => {
    registerPhase(makePhase("stub-det"));
    resetRegistry();
    registerPhase(makePhase("stub-agent"));
    const phases = registeredPhases();
    expect(phases).toHaveLength(1);
    expect(phases[0]?.id).toBe("stub-agent");
  });
});
