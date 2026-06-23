/**
 * Tests for SubmitVerdictTool — guards 1 & 2 of the submit_verdict tool (TDD A·2).
 *
 * Guard 1 (schema-validate-or-retry): invalid params are rejected with a corrective message;
 *   no state is captured — a later valid submission can still succeed.
 * Guard 2 (idempotency): the first valid submission wins; subsequent valid submissions are
 *   rejected with "already recorded" and the original payload is retained.
 *
 * Plan refs: M1 step 1 · TDD A·2
 */

import { describe, expect, test } from "vite-plus/test";
import { SubmitVerdictTool, VERDICT_TOOL_NAME } from "./submit-verdict.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UPHOLD = { verdict: "uphold", reason: "I reproduced the issue" };
const REFUTE = { verdict: "refute", reason: "cannot reproduce" };
const ABSTAIN = { verdict: "abstain", reason: "insufficient context" };

// ---------------------------------------------------------------------------
// Tool name constant
// ---------------------------------------------------------------------------

test("VERDICT_TOOL_NAME is 'submit_verdict'", () => {
  expect(VERDICT_TOOL_NAME).toBe("submit_verdict");
});

// ---------------------------------------------------------------------------
// Guard 1: schema-validate-or-retry
// ---------------------------------------------------------------------------

describe("SubmitVerdictTool — guard 1: schema-validate-or-retry", () => {
  test("unknown verdict → accepted:false", () => {
    const tool = new SubmitVerdictTool();
    const result = tool.submit({ verdict: "pass", reason: "looks good" });
    expect(result.accepted).toBe(false);
  });

  test("unknown verdict → corrective message names the validation problem", () => {
    const tool = new SubmitVerdictTool();
    const result = tool.submit({ verdict: "pass", reason: "looks good" });
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).toMatch(/submit_verdict/);
  });

  test("unknown verdict → hasSubmission stays false", () => {
    const tool = new SubmitVerdictTool();
    tool.submit({ verdict: "pass", reason: "looks good" });
    expect(tool.hasSubmission).toBe(false);
  });

  test("unknown verdict → submission is undefined", () => {
    const tool = new SubmitVerdictTool();
    tool.submit({ verdict: "pass", reason: "looks good" });
    expect(tool.submission).toBeUndefined();
  });

  test("missing reason → accepted:false", () => {
    const tool = new SubmitVerdictTool();
    const result = tool.submit({ verdict: "uphold" });
    expect(result.accepted).toBe(false);
  });

  test("missing verdict → accepted:false with corrective message", () => {
    const tool = new SubmitVerdictTool();
    const result = tool.submit({ reason: "forgot verdict" });
    expect(result.accepted).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  test("extra field (additionalProperties:false) → accepted:false", () => {
    const tool = new SubmitVerdictTool();
    const result = tool.submit({ verdict: "uphold", reason: "ok", extra: true });
    expect(result.accepted).toBe(false);
  });

  test("non-object params → accepted:false with corrective message", () => {
    const tool = new SubmitVerdictTool();
    const result = tool.submit("not an object");
    expect(result.accepted).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  test("null params → accepted:false with corrective message", () => {
    const tool = new SubmitVerdictTool();
    const result = tool.submit(null);
    expect(result.accepted).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  test("retry observed: invalid then valid → second call accepted:true", () => {
    const tool = new SubmitVerdictTool();
    const first = tool.submit({ verdict: "pass", reason: "bad" });
    expect(first.accepted).toBe(false);
    const second = tool.submit(UPHOLD);
    expect(second.accepted).toBe(true);
  });

  test("retry observed: invalid then valid → submission captured after valid call", () => {
    const tool = new SubmitVerdictTool();
    tool.submit({ verdict: "pass", reason: "bad" });
    tool.submit(UPHOLD);
    expect(tool.hasSubmission).toBe(true);
    expect(tool.submission).toEqual(UPHOLD);
  });
});

// ---------------------------------------------------------------------------
// Guard 1: all three valid verdicts are accepted
// ---------------------------------------------------------------------------

describe("SubmitVerdictTool — accepted verdicts", () => {
  test("uphold → accepted:true", () => {
    expect(new SubmitVerdictTool().submit(UPHOLD).accepted).toBe(true);
  });

  test("refute → accepted:true", () => {
    expect(new SubmitVerdictTool().submit(REFUTE).accepted).toBe(true);
  });

  test("abstain → accepted:true", () => {
    expect(new SubmitVerdictTool().submit(ABSTAIN).accepted).toBe(true);
  });

  test("first valid submit → message acknowledges recording", () => {
    const result = new SubmitVerdictTool().submit(UPHOLD);
    expect(result.message).toMatch(/recorded/i);
    expect(result.message).toMatch(/done/i);
  });

  test("first valid submit → submission getter returns typed payload", () => {
    const tool = new SubmitVerdictTool();
    tool.submit(UPHOLD);
    expect(tool.submission).toEqual(UPHOLD);
    expect(tool.submission?.verdict).toBe("uphold");
  });
});

// ---------------------------------------------------------------------------
// Guard 2: idempotency — first valid submission wins
// ---------------------------------------------------------------------------

describe("SubmitVerdictTool — guard 2: idempotency", () => {
  test("first valid submit → hasSubmission is true", () => {
    const tool = new SubmitVerdictTool();
    tool.submit(UPHOLD);
    expect(tool.hasSubmission).toBe(true);
  });

  test("3× valid submit → first wins (payload retained)", () => {
    const tool = new SubmitVerdictTool();
    tool.submit(UPHOLD);
    tool.submit(REFUTE);
    tool.submit(ABSTAIN);
    expect(tool.submission).toEqual(UPHOLD);
  });

  test("second valid submit → accepted:false", () => {
    const tool = new SubmitVerdictTool();
    tool.submit(UPHOLD);
    const second = tool.submit(REFUTE);
    expect(second.accepted).toBe(false);
  });

  test('second valid submit → message contains "already recorded"', () => {
    const tool = new SubmitVerdictTool();
    tool.submit(UPHOLD);
    const second = tool.submit(REFUTE);
    expect(second.message).toContain("already recorded");
  });

  test('second valid submit → message contains "stop now"', () => {
    const tool = new SubmitVerdictTool();
    tool.submit(UPHOLD);
    const second = tool.submit(REFUTE);
    expect(second.message).toContain("stop now");
  });
});

// ---------------------------------------------------------------------------
// State isolation — each SubmitVerdictTool instance is independent
// ---------------------------------------------------------------------------

describe("SubmitVerdictTool — instance isolation", () => {
  test("two separate instances do not share state", () => {
    const toolA = new SubmitVerdictTool();
    const toolB = new SubmitVerdictTool();
    toolA.submit(UPHOLD);
    expect(toolB.hasSubmission).toBe(false);
    const result = toolB.submit(REFUTE);
    expect(result.accepted).toBe(true);
    expect(toolB.submission).toEqual(REFUTE);
  });
});
