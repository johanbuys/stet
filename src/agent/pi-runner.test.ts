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
import { PiAgentRunner, buildBashToolDescription, splitBashFromToolset } from "./pi-runner.js";
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

// ---------------------------------------------------------------------------
// splitBashFromToolset — the bash-swap wiring (T13 review finding #3)
//
// The runner removes the SDK's unrestricted "bash" and registers the custom
// limit-enforcing tool only when "bash" was requested. This helper drives both
// the toolset passed to `tools` and whether the custom bash ToolDefinition is
// added to `customTools`, so it is covered hermetically here.
// ---------------------------------------------------------------------------

describe("splitBashFromToolset", () => {
  it("removes 'bash' and reports hasBash: true when present", () => {
    const { tools, hasBash } = splitBashFromToolset(["bash", "read", "submit_findings"]);
    expect(hasBash).toBe(true);
    expect(tools).toEqual(["read", "submit_findings"]);
    expect(tools).not.toContain("bash");
  });

  it("leaves the toolset unchanged and reports hasBash: false when absent", () => {
    const input = ["read", "grep", "submit_findings"];
    const { tools, hasBash } = splitBashFromToolset(input);
    expect(hasBash).toBe(false);
    // Referential identity preserved on the no-bash path.
    expect(tools).toBe(input);
  });

  it("removes every 'bash' occurrence if duplicated", () => {
    const { tools, hasBash } = splitBashFromToolset(["bash", "read", "bash"]);
    expect(hasBash).toBe(true);
    expect(tools).toEqual(["read"]);
  });
});

// ---------------------------------------------------------------------------
// buildBashToolDescription — Finding #2: stacked/contradictory truncation layers
//
// The SDK's createBashToolDefinition() hardcodes a description claiming:
//   "Output is truncated to last 2000 lines or 50KB… full output is saved to a temp file."
// When stet's bashOutputCap fires first (32KB < 50KB), the "full output" temp file, if any,
// contains only stet's capped data with a truncation marker — it is NOT a full output.
// The description must state stet's actual behavior (cap in bytes, in-band marker, no full
// output file) so the model is not misled about what data is available.
//
// buildBashToolDescription() is exported specifically for this hermetic assertion.
// The invariant: the description must NOT contain the SDK's "2000 lines or 50KB" claim,
// and MUST state the configured cap and the absence of a "full output" file when truncated.
// ---------------------------------------------------------------------------

describe("buildBashToolDescription", () => {
  it("states the configured cap in KiB and not the SDK's 2000-line/50KB claim", () => {
    const desc = buildBashToolDescription(32 * 1024);
    // Must NOT contain the SDK's stock claims about 2000 lines or 50KB.
    expect(desc).not.toMatch(/2000\s+lines/i);
    expect(desc).not.toMatch(/50\s*kb/i);
    // Must mention the actual cap (32KB).
    expect(desc).toMatch(/32\s*kb/i);
  });

  it("does not promise a 'full output' temp file when the cap is hit", () => {
    const desc = buildBashToolDescription(32 * 1024);
    // The SDK's misleading promise is: "full output is saved to a temp file".
    // Our description may *mention* a temp file in a negating context ("there is no … temp file"),
    // but must NOT promise that one exists (i.e. "saved to a temp file").
    expect(desc).not.toMatch(/saved to a temp file/i);
  });

  it("mentions the in-band truncation marker instead", () => {
    const desc = buildBashToolDescription(32 * 1024);
    expect(desc).toMatch(/truncation marker|truncated/i);
  });

  it("reflects a different cap when configured differently", () => {
    const desc = buildBashToolDescription(64 * 1024);
    expect(desc).toMatch(/64\s*kb/i);
    expect(desc).not.toMatch(/32\s*kb/i);
  });
});
