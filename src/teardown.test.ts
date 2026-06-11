/**
 * Tests for src/teardown.ts — service teardown hook (T16, M4 step 4).
 *
 * For M4, teardownServices() is a no-op; the session and process-group cleanup
 * happens automatically via the AbortSignal chain. This test verifies the
 * seam is callable and well-behaved before Phase 5 fills it with real cleanup.
 */

import { describe, it, expect } from "vite-plus/test";
import { teardownServices } from "./teardown.js";

describe("teardownServices (M4 no-op)", () => {
  it("is callable without throwing", () => {
    expect(() => teardownServices()).not.toThrow();
  });

  it("returns undefined", () => {
    expect(teardownServices()).toBeUndefined();
  });
});
