/**
 * Tests for SubmitTool — guards 1 & 2 of the "output-as-tool" contract.
 *
 * Guard 1 (schema-validate-or-retry): invalid params are rejected with a corrective message
 *   and no state is captured — a later valid submission can still succeed (retry observed).
 * Guard 2 (idempotency): the first valid submission wins; subsequent valid submissions are
 *   rejected with "already recorded" and the original payload is retained.
 *
 * PRD refs: §3.1 (output-as-tool guards), §4.6 (confidence).
 * Plan refs: M2 T8, decisions P1/P10.
 *
 * T10 seam: PiAgentRunner wires SubmitTool into Pi SDK's defineTool.execute and reads
 *   .submission after the session ends.
 */

import { Type } from "@sinclair/typebox";
import { describe, expect, test } from "vite-plus/test";
import { SubmitTool } from "./submit-tool.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal TypeBox schema for submit_findings params: requires { findings: unknown[] }. */
const SUBMIT_SCHEMA = Type.Object(
  {
    findings: Type.Array(Type.Unknown()),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** A valid payload that satisfies SUBMIT_SCHEMA. */
const VALID_PAYLOAD = { findings: [{ id: "test.x", message: "ok" }] };

/** An invalid payload — missing required 'findings' field. */
const INVALID_PAYLOAD = { note: "forgot findings" };

// ---------------------------------------------------------------------------
// Guard 1: schema-validate-or-retry
// ---------------------------------------------------------------------------

describe("SubmitTool — guard 1: schema-validate-or-retry", () => {
  test("invalid params → accepted:false", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    const result = tool.submit(INVALID_PAYLOAD);
    expect(result.accepted).toBe(false);
  });

  test("invalid params → corrective message (names the validation problem)", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    const result = tool.submit(INVALID_PAYLOAD);
    // Message must be non-empty and reference the schema failure
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
    // Should name the path or field that failed
    expect(result.message).toMatch(/findings/i);
  });

  test("invalid params → hasSubmission stays false", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    tool.submit(INVALID_PAYLOAD);
    expect(tool.hasSubmission).toBe(false);
  });

  test("invalid params → submission getter is undefined", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    tool.submit(INVALID_PAYLOAD);
    expect(tool.submission).toBeUndefined();
  });

  test("retry observed: invalid then valid → second call accepted:true", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    const first = tool.submit(INVALID_PAYLOAD);
    expect(first.accepted).toBe(false);
    const second = tool.submit(VALID_PAYLOAD);
    expect(second.accepted).toBe(true);
  });

  test("retry observed: invalid then valid → submission is captured after valid call", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    tool.submit(INVALID_PAYLOAD);
    tool.submit(VALID_PAYLOAD);
    expect(tool.hasSubmission).toBe(true);
    expect(tool.submission).toEqual(VALID_PAYLOAD);
  });

  test("non-object params → accepted:false with corrective message", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    const result = tool.submit("not an object");
    expect(result.accepted).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  test("null params → accepted:false with corrective message", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    const result = tool.submit(null);
    expect(result.accepted).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Guard 2: idempotency — first valid submission wins
// ---------------------------------------------------------------------------

describe("SubmitTool — guard 2: idempotency", () => {
  test("first valid submit → accepted:true", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    const result = tool.submit(VALID_PAYLOAD);
    expect(result.accepted).toBe(true);
  });

  test("first valid submit → message acknowledges recording", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    const result = tool.submit(VALID_PAYLOAD);
    expect(result.message).toMatch(/recorded/i);
    expect(result.message).toMatch(/done/i);
  });

  test("first valid submit → hasSubmission is true", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    tool.submit(VALID_PAYLOAD);
    expect(tool.hasSubmission).toBe(true);
  });

  test("first valid submit → submission getter returns the payload", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    tool.submit(VALID_PAYLOAD);
    expect(tool.submission).toEqual(VALID_PAYLOAD);
  });

  test("3× valid submit → first wins (payload retained)", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    const firstPayload = { findings: [{ id: "first" }] };
    const secondPayload = { findings: [{ id: "second" }] };
    const thirdPayload = { findings: [{ id: "third" }] };
    tool.submit(firstPayload);
    tool.submit(secondPayload);
    tool.submit(thirdPayload);
    expect(tool.submission).toEqual(firstPayload);
  });

  test("3× valid submit → second call → accepted:false", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    tool.submit(VALID_PAYLOAD);
    const second = tool.submit(VALID_PAYLOAD);
    expect(second.accepted).toBe(false);
  });

  test("3× valid submit → third call → accepted:false", () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    tool.submit(VALID_PAYLOAD);
    tool.submit(VALID_PAYLOAD);
    const third = tool.submit(VALID_PAYLOAD);
    expect(third.accepted).toBe(false);
  });

  test('2nd valid submit → message contains "already recorded"', () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    tool.submit(VALID_PAYLOAD);
    const second = tool.submit(VALID_PAYLOAD);
    expect(second.message).toContain("already recorded");
  });

  test('2nd valid submit → message contains "stop now"', () => {
    const tool = new SubmitTool(SUBMIT_SCHEMA);
    tool.submit(VALID_PAYLOAD);
    const second = tool.submit(VALID_PAYLOAD);
    expect(second.message).toContain("stop now");
  });
});

// ---------------------------------------------------------------------------
// State isolation — each SubmitTool instance is independent
// ---------------------------------------------------------------------------

describe("SubmitTool — instance isolation", () => {
  test("two separate instances do not share state", () => {
    const toolA = new SubmitTool(SUBMIT_SCHEMA);
    const toolB = new SubmitTool(SUBMIT_SCHEMA);
    toolA.submit(VALID_PAYLOAD);
    // toolB should be unaffected
    expect(toolB.hasSubmission).toBe(false);
    const result = toolB.submit(VALID_PAYLOAD);
    expect(result.accepted).toBe(true);
  });
});
