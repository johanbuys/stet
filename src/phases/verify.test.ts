/**
 * Tests for runAgreementVerify — agreement-verify stage (TDD A·2/A·3/A·4).
 *
 * All tests use FakeAgentRunner (T1) with a per-call script queue — no model required.
 * The VerifyAudit schema from report.ts (T2) is used for the dropped entries.
 * VoterVerdict submission is the OkScript payload (T3 contract).
 *
 * Accept criteria (M1 step 2–4):
 *   - 3-uphold → confidence "high"
 *   - 2-uphold → confidence "medium"
 *   - 1-uphold → dropped (in audit.verify)
 *   - voter erroring twice → abstain (absolute threshold preserved)
 *
 * Plan refs: M1 steps 2–4 · TDD A·2/A·3/A·4.
 */

import { describe, expect, test } from "vite-plus/test";
import { ModelError } from "../errors.js";
import type { Finding } from "../schema/finding.js";
import type { OkScript, ErrScript } from "../agent/fake-runner.js";
import { FakeAgentRunner } from "../agent/fake-runner.js";
import { runAgreementVerify, type VerifyConfig } from "./verify.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ZERO_COST = { durationMs: 0 };

const UPHOLD: OkScript = {
  kind: "ok",
  submission: { verdict: "uphold", reason: "I can reproduce this" },
  cost: ZERO_COST,
};
const REFUTE: OkScript = {
  kind: "ok",
  submission: { verdict: "refute", reason: "Cannot reproduce" },
  cost: ZERO_COST,
};
const ABSTAIN_SCRIPT: OkScript = {
  kind: "ok",
  submission: { verdict: "abstain", reason: "Insufficient context" },
  cost: ZERO_COST,
};
const ERR: ErrScript = {
  kind: "err",
  error: new ModelError({ message: "model unavailable", cost: ZERO_COST }),
};

function makeFinding(id: string, opts: Partial<Finding> = {}): Finding {
  return {
    id,
    phase: "review",
    severity: "error",
    confidence: "low",
    message: `bug in ${id}`,
    ...opts,
  };
}

const DEFAULT_CFG: VerifyConfig = {
  voters: 3,
  lenses: ["lens-a", "lens-b", "lens-c"],
  agreementForHigh: 3,
  agreementForMedium: 2,
  budgets: { wallClockMs: 60_000, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 4096 },
};

const CTX = { cwd: "/tmp/repo" };

// ---------------------------------------------------------------------------
// Empty candidates
// ---------------------------------------------------------------------------

test("empty candidates → received=0, verified=[], dropped=[]", async () => {
  const runner = new FakeAgentRunner({
    kind: "ok",
    submission: { verdict: "uphold", reason: "x" },
    cost: ZERO_COST,
  });
  const { verified, audit } = await runAgreementVerify(runner, [], DEFAULT_CFG, CTX);
  expect(verified).toHaveLength(0);
  expect(audit.received).toBe(0);
  expect(audit.dropped).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Confidence tiers (TDD A·2 acceptance)
// ---------------------------------------------------------------------------

describe("runAgreementVerify — confidence tiers", () => {
  test("3-uphold → confidence 'high', not dropped", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, UPHOLD]);
    const finding = makeFinding("f1");
    const { verified, audit } = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(verified).toHaveLength(1);
    expect(verified[0]!.confidence).toBe("high");
    expect(audit.dropped).toHaveLength(0);
  });

  test("3-uphold → audit.received = 1", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, UPHOLD]);
    const { audit } = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(audit.received).toBe(1);
  });

  test("2-uphold, 1-refute → confidence 'medium', not dropped", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, REFUTE]);
    const finding = makeFinding("f1");
    const { verified, audit } = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(verified).toHaveLength(1);
    expect(verified[0]!.confidence).toBe("medium");
    expect(audit.dropped).toHaveLength(0);
  });

  test("1-uphold, 2-refute → dropped (in audit.verify)", async () => {
    const runner = new FakeAgentRunner([UPHOLD, REFUTE, REFUTE]);
    const finding = makeFinding("f1");
    const { verified, audit } = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(verified).toHaveLength(0);
    expect(audit.dropped).toHaveLength(1);
    expect(audit.dropped[0]!.id).toBe("f1");
    expect(audit.dropped[0]!.upholds).toBe(1);
  });

  test("0-upholds (all refute) → dropped with upholds=0", async () => {
    const runner = new FakeAgentRunner([REFUTE, REFUTE, REFUTE]);
    const { verified, audit } = await runAgreementVerify(
      runner,
      [makeFinding("f1")],
      DEFAULT_CFG,
      CTX,
    );
    expect(verified).toHaveLength(0);
    expect(audit.dropped[0]!.upholds).toBe(0);
  });

  test("abstain verdict counts as not-uphold (2-uphold, 1-abstain → medium)", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, ABSTAIN_SCRIPT]);
    const { verified } = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(verified).toHaveLength(1);
    expect(verified[0]!.confidence).toBe("medium");
  });

  test("abstain-only → dropped", async () => {
    const runner = new FakeAgentRunner([ABSTAIN_SCRIPT, ABSTAIN_SCRIPT, ABSTAIN_SCRIPT]);
    const { verified, audit } = await runAgreementVerify(
      runner,
      [makeFinding("f1")],
      DEFAULT_CFG,
      CTX,
    );
    expect(verified).toHaveLength(0);
    expect(audit.dropped).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Failure semantics — retry once, then abstain (TDD A·3)
// ---------------------------------------------------------------------------

describe("runAgreementVerify — failure & abstention (TDD A·3)", () => {
  test("voter erroring twice → abstain; 2 other upholds → medium (absolute threshold)", async () => {
    // Queue: voter-0 err×2 (→ abstain), voter-1 uphold, voter-2 uphold → 2 upholds
    const runner = new FakeAgentRunner([ERR, ERR, UPHOLD, UPHOLD]);
    const { verified, audit } = await runAgreementVerify(
      runner,
      [makeFinding("f1")],
      DEFAULT_CFG,
      CTX,
    );
    expect(verified).toHaveLength(1);
    expect(verified[0]!.confidence).toBe("medium");
    expect(audit.dropped).toHaveLength(0);
  });

  test("voter erroring twice → abstain; only 1 other uphold → dropped", async () => {
    // Queue: voter-0 err×2 (→ abstain), voter-1 uphold, voter-2 refute → 1 uphold
    const runner = new FakeAgentRunner([ERR, ERR, UPHOLD, REFUTE]);
    const { verified, audit } = await runAgreementVerify(
      runner,
      [makeFinding("f1")],
      DEFAULT_CFG,
      CTX,
    );
    expect(verified).toHaveLength(0);
    expect(audit.dropped).toHaveLength(1);
    expect(audit.dropped[0]!.upholds).toBe(1);
  });

  test("voter erroring once (retry succeeds with uphold) → counts as uphold", async () => {
    // Queue: voter-0 err, retry ok(uphold), voter-1 uphold, voter-2 uphold → 3 upholds
    const runner = new FakeAgentRunner([ERR, UPHOLD, UPHOLD, UPHOLD]);
    const { verified } = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(verified).toHaveLength(1);
    expect(verified[0]!.confidence).toBe("high");
  });

  test("voter erroring twice → synthesized abstain in dropped.verdicts", async () => {
    // voter-0 err×2 → abstain, voter-1 refute, voter-2 refute → 0 upholds → dropped
    const runner = new FakeAgentRunner([ERR, ERR, REFUTE, REFUTE]);
    const { audit } = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(audit.dropped).toHaveLength(1);
    const dropped = audit.dropped[0]!;
    expect(dropped.verdicts).toHaveLength(3);
    // First verdict is the synthesized abstain
    expect(dropped.verdicts[0]!.verdict).toBe("abstain");
    expect(typeof dropped.verdicts[0]!.reason).toBe("string");
  });

  test("absolute threshold preserved: all 3 voters err → 0 upholds → dropped", async () => {
    // Each voter errors twice (6 err calls total) → 0 upholds → dropped
    const runner = new FakeAgentRunner([ERR, ERR, ERR, ERR, ERR, ERR]);
    const { verified, audit } = await runAgreementVerify(
      runner,
      [makeFinding("f1")],
      DEFAULT_CFG,
      CTX,
    );
    expect(verified).toHaveLength(0);
    expect(audit.dropped).toHaveLength(1);
    expect(audit.dropped[0]!.upholds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Audit surface (TDD A·4)
// ---------------------------------------------------------------------------

describe("runAgreementVerify — audit surface (TDD A·4)", () => {
  test("dropped entry carries id, upholds, and per-voter verdicts", async () => {
    const runner = new FakeAgentRunner([UPHOLD, REFUTE, REFUTE]);
    const { audit } = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    const entry = audit.dropped[0]!;
    expect(entry.id).toBe("f1");
    expect(entry.upholds).toBe(1);
    expect(entry.verdicts).toHaveLength(3);
    expect(entry.verdicts[0]!.verdict).toBe("uphold");
    expect(entry.verdicts[1]!.verdict).toBe("refute");
    expect(entry.verdicts[2]!.verdict).toBe("refute");
  });

  test("dropped entry carries specialist when present on finding", async () => {
    const runner = new FakeAgentRunner([REFUTE, REFUTE, REFUTE]);
    const finding = makeFinding("f1", { specialist: "bugs" });
    const { audit } = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(audit.dropped[0]!.specialist).toBe("bugs");
  });

  test("dropped entry has no specialist when finding has none", async () => {
    const runner = new FakeAgentRunner([REFUTE, REFUTE, REFUTE]);
    const { audit } = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(audit.dropped[0]!.specialist).toBeUndefined();
  });

  test("audit.received = candidates.length for mixed verified/dropped", async () => {
    // 2 candidates: first 3 upholds (high), second 0 upholds (dropped)
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, UPHOLD, REFUTE, REFUTE, REFUTE]);
    const candidates = [makeFinding("f1"), makeFinding("f2")];
    const { audit } = await runAgreementVerify(runner, candidates, DEFAULT_CFG, CTX);
    expect(audit.received).toBe(2);
    expect(audit.dropped).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Confidence harness-stamping (TDD A·4)
// ---------------------------------------------------------------------------

describe("runAgreementVerify — confidence harness-stamping (TDD A·4)", () => {
  test("original candidate confidence is overwritten by harness-stamped value", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, UPHOLD]);
    const finding = makeFinding("f1", { confidence: "low" });
    const { verified } = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(verified[0]!.confidence).toBe("high");
  });

  test("other finding fields are preserved after confidence stamping", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, REFUTE]);
    const finding = makeFinding("f1", {
      specialist: "bugs",
      message: "null deref",
      severity: "error",
    });
    const { verified } = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(verified[0]!.id).toBe("f1");
    expect(verified[0]!.specialist).toBe("bugs");
    expect(verified[0]!.message).toBe("null deref");
    expect(verified[0]!.severity).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Multiple candidates (processed independently)
// ---------------------------------------------------------------------------

describe("runAgreementVerify — multiple candidates", () => {
  test("two candidates processed independently — both high", async () => {
    // f1: 3 upholds, f2: 3 upholds (6 calls total, in order)
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, UPHOLD, UPHOLD, UPHOLD, UPHOLD]);
    const candidates = [makeFinding("f1"), makeFinding("f2")];
    const { verified, audit } = await runAgreementVerify(runner, candidates, DEFAULT_CFG, CTX);
    expect(verified).toHaveLength(2);
    expect(verified[0]!.confidence).toBe("high");
    expect(verified[1]!.confidence).toBe("high");
    expect(audit.received).toBe(2);
    expect(audit.dropped).toHaveLength(0);
  });

  test("two candidates: first passes (medium), second dropped", async () => {
    // f1: uphold,uphold,refute → medium; f2: refute,refute,refute → dropped
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, REFUTE, REFUTE, REFUTE, REFUTE]);
    const candidates = [makeFinding("f1"), makeFinding("f2")];
    const { verified, audit } = await runAgreementVerify(runner, candidates, DEFAULT_CFG, CTX);
    expect(verified).toHaveLength(1);
    expect(verified[0]!.id).toBe("f1");
    expect(verified[0]!.confidence).toBe("medium");
    expect(audit.dropped).toHaveLength(1);
    expect(audit.dropped[0]!.id).toBe("f2");
  });
});
