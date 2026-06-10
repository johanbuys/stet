/**
 * PiAgentRunner hermetic tests — no network, no API key.
 *
 * These tests cover only paths that are exercisable without a live model:
 *   1. Malformed inputs.model (no slash) → Err(ModelError), never throws.
 *   2. Structural: PiAgentRunner satisfies the AgentRunner contract.
 *
 * The real round-trip (model.find → prompt → submission) is T11's
 * keyed/skippable suite. We deliberately keep T10 tests offline.
 *
 * NOTE on "well-formed-but-nonexistent model → Err(ModelError)":
 *   ModelRegistry.create() reads ~/.pi/agent/auth.json on disk. On machines with
 *   credentials the registry may attempt a network lookup. We skip this case here
 *   and leave it to T11's keyed suite to cover with a real model.
 *
 * PRD refs: §3.1 (no-throw contract), plan §2a T10.
 */

import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vite-plus/test";
import { PiAgentRunner } from "./pi-runner.js";
import type { AgentRunInputs } from "./runner.js";

// ---------------------------------------------------------------------------
// Minimal inputs fixture — reused across tests.
// The schema and toolset never reach the SDK in the malformed-model path.
// ---------------------------------------------------------------------------

const dummySchema = Type.Object({ findings: Type.Array(Type.Unknown()) });

const minimalInputs: AgentRunInputs = {
  rubric: "You are a test agent.",
  userPrompt: "Do nothing.",
  toolset: ["read", "submit_findings"],
  submitSchema: dummySchema,
  budgets: {
    wallClockMs: 5_000,
    turns: 1,
    bashTimeoutMs: 1_000,
    bashOutputCap: 1_024,
  },
  model: "no-slash-model", // Malformed — no "/" separator
  cwd: "/tmp",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PiAgentRunner", () => {
  it("is an AgentRunner (has a .run function)", () => {
    const runner = new PiAgentRunner();
    expect(typeof runner.run).toBe("function");
  });

  it("returns Err(ModelError) for malformed model string — never throws", async () => {
    const runner = new PiAgentRunner();
    // Must not throw — the contract is that run() always resolves.
    const result = await runner.run(minimalInputs);

    expect(result.isErr()).toBe(true);
    // Narrow to the error branch.
    if (result.isErr()) {
      const error = result.error;
      expect(error._tag).toBe("ModelError");
      // Further narrow to ModelError to access .cost (BudgetError has a different shape).
      if (error._tag === "ModelError") {
        // Cost should carry durationMs: 0 (caught before any SDK work).
        expect(error.cost.durationMs).toBe(0);
        // Message should name the bad string.
        expect(error.message).toContain("no-slash-model");
      }
    }
  });

  it("Err resolves, not rejects — await does not throw", async () => {
    const runner = new PiAgentRunner();
    // This assertion verifies the no-throw contract explicitly.
    await expect(runner.run(minimalInputs)).resolves.toBeDefined();
  });
});
