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
import { BudgetError, ModelError } from "../errors.js";
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
const BUDGET_ERR: ErrScript = {
  kind: "err",
  error: new BudgetError({ limit: "wallClockMs", message: "wall-clock budget exceeded" }),
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
  const res = await runAgreementVerify(runner, [], DEFAULT_CFG, CTX);
  expect(res.isOk()).toBe(true);
  if (!res.isOk()) return;
  const { verified, audit } = res.value;
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
    const res = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { verified, audit } = res.value;
    expect(verified).toHaveLength(1);
    expect(verified[0]!.confidence).toBe("high");
    expect(audit.dropped).toHaveLength(0);
  });

  test("3-uphold → audit.received = 1", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, UPHOLD]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.audit.received).toBe(1);
  });

  test("2-uphold, 1-refute → confidence 'medium', not dropped", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, REFUTE]);
    const finding = makeFinding("f1");
    const res = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { verified, audit } = res.value;
    expect(verified).toHaveLength(1);
    expect(verified[0]!.confidence).toBe("medium");
    expect(audit.dropped).toHaveLength(0);
  });

  test("1-uphold, 2-refute → dropped (in audit.verify)", async () => {
    const runner = new FakeAgentRunner([UPHOLD, REFUTE, REFUTE]);
    const finding = makeFinding("f1");
    const res = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { verified, audit } = res.value;
    expect(verified).toHaveLength(0);
    expect(audit.dropped).toHaveLength(1);
    expect(audit.dropped[0]!.id).toBe("f1");
    expect(audit.dropped[0]!.upholds).toBe(1);
  });

  test("0-upholds (all refute) → dropped with upholds=0", async () => {
    const runner = new FakeAgentRunner([REFUTE, REFUTE, REFUTE]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.audit.dropped[0]!.upholds).toBe(0);
  });

  test("abstain verdict counts as not-uphold (2-uphold, 1-abstain → medium)", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, ABSTAIN_SCRIPT]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.verified).toHaveLength(1);
    expect(res.value.verified[0]!.confidence).toBe("medium");
  });

  test("abstain-only → dropped", async () => {
    const runner = new FakeAgentRunner([ABSTAIN_SCRIPT, ABSTAIN_SCRIPT, ABSTAIN_SCRIPT]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { verified, audit } = res.value;
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
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { verified, audit } = res.value;
    expect(verified).toHaveLength(1);
    expect(verified[0]!.confidence).toBe("medium");
    expect(audit.dropped).toHaveLength(0);
  });

  test("voter erroring twice → abstain; only 1 other uphold → dropped", async () => {
    // Queue: voter-0 err×2 (→ abstain), voter-1 uphold, voter-2 refute → 1 uphold
    const runner = new FakeAgentRunner([ERR, ERR, UPHOLD, REFUTE]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { verified, audit } = res.value;
    expect(verified).toHaveLength(0);
    expect(audit.dropped).toHaveLength(1);
    expect(audit.dropped[0]!.upholds).toBe(1);
  });

  test("voter erroring once (retry succeeds with uphold) → counts as uphold", async () => {
    // Queue: voter-0 err, retry ok(uphold), voter-1 uphold, voter-2 uphold → 3 upholds
    const runner = new FakeAgentRunner([ERR, UPHOLD, UPHOLD, UPHOLD]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.verified).toHaveLength(1);
    expect(res.value.verified[0]!.confidence).toBe("high");
  });

  test("voter erroring twice → synthesized abstain in dropped.verdicts", async () => {
    // voter-0 err×2 → abstain, voter-1 refute, voter-2 refute → 0 upholds → dropped
    const runner = new FakeAgentRunner([ERR, ERR, REFUTE, REFUTE]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { audit } = res.value;
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
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { verified, audit } = res.value;
    expect(verified).toHaveLength(0);
    expect(audit.dropped).toHaveLength(1);
    expect(audit.dropped[0]!.upholds).toBe(0);
  });

  // ── Finding #1: non-transient error retry policy ──────────────────────────

  test("#1: BudgetError on first attempt → no retry; abstain with accurate reason", async () => {
    // Queue has only ONE entry: a BudgetError. If the code wrongly retries,
    // FakeAgentRunner throws "queue exhausted". Correct behaviour: no retry → abstain.
    const runner = new FakeAgentRunner([BUDGET_ERR, REFUTE, REFUTE]);
    // voter-0: BudgetError (no retry) → abstain; voter-1,2: refute → 0 upholds → dropped
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { audit } = res.value;
    expect(audit.dropped).toHaveLength(1);
    const dropped = audit.dropped[0]!;
    // First verdict should be the abstain synthesized from BudgetError (no retry)
    expect(dropped.verdicts[0]!.verdict).toBe("abstain");
    expect(dropped.verdicts[0]!.reason).toContain("attempt");
  });

  test("#1: cancelled signal → no retry; abstain immediately", async () => {
    // Pre-abort the signal so ctx.signal.aborted is true before callVoter runs.
    // Queue has only ONE entry per voter. If the code wrongly retries, queue exhausts.
    // voter-0: ERR (signal aborted → no retry) → abstain; voter-1,2: refute → dropped
    const ctrl = new AbortController();
    ctrl.abort();
    const runner = new FakeAgentRunner([ERR, REFUTE, REFUTE]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, {
      ...CTX,
      signal: ctrl.signal,
    });
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { audit } = res.value;
    expect(audit.dropped).toHaveLength(1);
    expect(audit.dropped[0]!.verdicts[0]!.verdict).toBe("abstain");
  });

  // ── Finding #5: Ok run with invalid submission ────────────────────────────

  test("#5: Ok result with invalid submission → abstain with 'unparseable verdict' reason", async () => {
    // Return a payload that is NOT a valid VoterVerdict (missing verdict field)
    const INVALID_SUBMIT: OkScript = {
      kind: "ok",
      submission: { not_verdict: "oops" },
      cost: ZERO_COST,
    };
    // voter-0: invalid submission → abstain(unparseable); voter-1,2: refute → 0 upholds → dropped
    const runner = new FakeAgentRunner([INVALID_SUBMIT, REFUTE, REFUTE]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { audit } = res.value;
    expect(audit.dropped).toHaveLength(1);
    const dropped = audit.dropped[0]!;
    expect(dropped.verdicts[0]!.verdict).toBe("abstain");
    // Reason must accurately name the cause (not "errored")
    expect(dropped.verdicts[0]!.reason).toMatch(/unparseable/i);
  });

  test("#5: Ok run with invalid submission is distinct from double-error abstain reason", async () => {
    const INVALID_SUBMIT: OkScript = {
      kind: "ok",
      submission: { not_verdict: "bad" },
      cost: ZERO_COST,
    };
    // Two scenarios: invalid-submit vs double-err — reasons must differ
    const runnerInvalid = new FakeAgentRunner([INVALID_SUBMIT, REFUTE, REFUTE]);
    const runnerErr = new FakeAgentRunner([ERR, ERR, REFUTE, REFUTE]);

    const resInvalid = await runAgreementVerify(
      runnerInvalid,
      [makeFinding("f1")],
      DEFAULT_CFG,
      CTX,
    );
    expect(resInvalid.isOk()).toBe(true);
    if (!resInvalid.isOk()) return;
    const droppedInvalid = resInvalid.value.audit.dropped[0]!;
    // Invalid-submission reason must mention "unparseable"
    expect(droppedInvalid.verdicts[0]!.reason).toMatch(/unparseable/i);

    const resErr = await runAgreementVerify(runnerErr, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(resErr.isOk()).toBe(true);
    if (!resErr.isOk()) return;
    const droppedErr = resErr.value.audit.dropped[0]!;
    // Double-error reason should mention "errored" or "attempts"
    expect(droppedErr.verdicts[0]!.reason).toMatch(/err|attempt/i);

    // The two reasons are different
    expect(droppedInvalid.verdicts[0]!.reason).not.toBe(droppedErr.verdicts[0]!.reason);
  });
});

// ---------------------------------------------------------------------------
// Audit surface (TDD A·4)
// ---------------------------------------------------------------------------

describe("runAgreementVerify — audit surface (TDD A·4)", () => {
  test("dropped entry carries id, upholds, and per-voter verdicts", async () => {
    const runner = new FakeAgentRunner([UPHOLD, REFUTE, REFUTE]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const entry = res.value.audit.dropped[0]!;
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
    const res = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.audit.dropped[0]!.specialist).toBe("bugs");
  });

  test("dropped entry has no specialist when finding has none", async () => {
    const runner = new FakeAgentRunner([REFUTE, REFUTE, REFUTE]);
    const res = await runAgreementVerify(runner, [makeFinding("f1")], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.audit.dropped[0]!.specialist).toBeUndefined();
  });

  test("audit.received = candidates.length for mixed verified/dropped", async () => {
    // 2 candidates: first 3 upholds (high), second 0 upholds (dropped)
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, UPHOLD, REFUTE, REFUTE, REFUTE]);
    const candidates = [makeFinding("f1"), makeFinding("f2")];
    const res = await runAgreementVerify(runner, candidates, DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.audit.received).toBe(2);
    expect(res.value.audit.dropped).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Confidence harness-stamping (TDD A·4)
// ---------------------------------------------------------------------------

describe("runAgreementVerify — confidence harness-stamping (TDD A·4)", () => {
  test("original candidate confidence is overwritten by harness-stamped value", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, UPHOLD]);
    const finding = makeFinding("f1", { confidence: "low" });
    const res = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.verified[0]!.confidence).toBe("high");
  });

  test("other finding fields are preserved after confidence stamping", async () => {
    const runner = new FakeAgentRunner([UPHOLD, UPHOLD, REFUTE]);
    const finding = makeFinding("f1", {
      specialist: "bugs",
      message: "null deref",
      severity: "error",
    });
    const res = await runAgreementVerify(runner, [finding], DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const v = res.value.verified[0]!;
    expect(v.id).toBe("f1");
    expect(v.specialist).toBe("bugs");
    expect(v.message).toBe("null deref");
    expect(v.severity).toBe("error");
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
    const res = await runAgreementVerify(runner, candidates, DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { verified, audit } = res.value;
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
    const res = await runAgreementVerify(runner, candidates, DEFAULT_CFG, CTX);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    const { verified, audit } = res.value;
    expect(verified).toHaveLength(1);
    expect(verified[0]!.id).toBe("f1");
    expect(verified[0]!.confidence).toBe("medium");
    expect(audit.dropped).toHaveLength(1);
    expect(audit.dropped[0]!.id).toBe("f2");
  });
});

// ---------------------------------------------------------------------------
// Finding #3: config validation → Err(ConfigError)
// ---------------------------------------------------------------------------

describe("runAgreementVerify — config validation (Finding #3)", () => {
  test("lenses.length !== voters → Err(ConfigError)", async () => {
    const runner = new FakeAgentRunner(UPHOLD);
    const badCfg: VerifyConfig = { ...DEFAULT_CFG, voters: 3, lenses: ["only-one"] };
    const res = await runAgreementVerify(runner, [makeFinding("f1")], badCfg, CTX);
    expect(res.isErr()).toBe(true);
    if (!res.isErr()) return;
    expect(res.error._tag).toBe("ConfigError");
    expect(res.error.message).toContain("lenses");
  });

  test("voters < 1 → Err(ConfigError)", async () => {
    const runner = new FakeAgentRunner(UPHOLD);
    const badCfg: VerifyConfig = { ...DEFAULT_CFG, voters: 0, lenses: [] };
    const res = await runAgreementVerify(runner, [makeFinding("f1")], badCfg, CTX);
    expect(res.isErr()).toBe(true);
    if (!res.isErr()) return;
    expect(res.error._tag).toBe("ConfigError");
  });

  test("voters=1 with matching lenses → Ok", async () => {
    const runner = new FakeAgentRunner([UPHOLD]);
    const cfg: VerifyConfig = {
      ...DEFAULT_CFG,
      voters: 1,
      lenses: ["single-lens"],
      agreementForHigh: 1,
      agreementForMedium: 1,
    };
    const res = await runAgreementVerify(runner, [makeFinding("f1")], cfg, CTX);
    expect(res.isOk()).toBe(true);
  });
});
