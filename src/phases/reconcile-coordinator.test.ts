/**
 * Focused unit tests for reconcileCoordinator (composite.ts).
 *
 * Encodes the coordinator-OK reconciliation semantics directly, without driving a
 * full composite run: re-attribution by id, harness-owned confidence re-stamp, the
 * protected-class reinstatement, non-protected drop audit, multiplicity accounting,
 * and cross-cutting pass-through.
 *
 * PRD refs: §3.3a, §4.4, §4.6; decisions #30, #31, #48; TDD A·4.
 */

import { describe, expect, it } from "vite-plus/test";
import type { Finding } from "../schema/finding.js";
import { reconcileCoordinator } from "./composite.js";

function makeFinding(partial: Partial<Finding> & Pick<Finding, "id">): Finding {
  return {
    phase: "review",
    severity: "warning",
    confidence: "low",
    message: `finding ${partial.id}`,
    ...partial,
  };
}

describe("reconcileCoordinator", () => {
  it("passes through a non-protected finding the judge keeps", () => {
    const candidate = makeFinding({ id: "a", severity: "warning", confidence: "low" });
    const { finalFindings, reinstated, dropped } = reconcileCoordinator(
      [candidate],
      [candidate],
      false,
      "review",
    );

    expect(finalFindings).toHaveLength(1);
    expect(finalFindings[0]!.id).toBe("a");
    expect(reinstated).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it("records a dropped non-protected finding in the drop audit", () => {
    const candidate = makeFinding({
      id: "x",
      severity: "warning",
      confidence: "low",
      specialist: "quality",
    });
    const { finalFindings, reinstated, dropped } = reconcileCoordinator(
      [],
      [candidate],
      false,
      "review",
    );

    expect(finalFindings).toEqual([]);
    expect(reinstated).toEqual([]);
    expect(dropped).toEqual([{ id: "x", message: candidate.message, specialist: "quality" }]);
  });

  it("reinstates an evidence-backed finding the judge dropped", () => {
    const candidate = makeFinding({
      id: "x",
      severity: "error",
      confidence: "low",
      evidence: { command: "npm test" },
    });
    const { finalFindings, reinstated, dropped } = reconcileCoordinator(
      [],
      [candidate],
      false,
      "review",
    );

    expect(reinstated).toEqual([{ id: "x" }]);
    expect(dropped).toEqual([]);
    expect(finalFindings).toHaveLength(1);
    expect(finalFindings[0]).toMatchObject({
      id: "x",
      severity: "error",
      evidence: { command: "npm test" },
      phase: "review",
    });
  });

  it("reinstates a verify-high finding the judge dropped", () => {
    const candidate = makeFinding({ id: "x", severity: "warning", confidence: "high" });
    const { finalFindings, reinstated, dropped } = reconcileCoordinator(
      [],
      [candidate],
      true,
      "review",
    );

    expect(reinstated).toEqual([{ id: "x" }]);
    expect(dropped).toEqual([]);
    expect(finalFindings).toHaveLength(1);
    expect(finalFindings[0]!.id).toBe("x");
  });

  it("reinstates a protected finding the judge downgraded in severity, in place", () => {
    const candidate = makeFinding({ id: "x", severity: "error", confidence: "high" });
    const downgraded = makeFinding({ id: "x", severity: "warning", confidence: "low" });
    const { finalFindings, reinstated, dropped } = reconcileCoordinator(
      [downgraded],
      [candidate],
      true,
      "review",
    );

    expect(reinstated).toEqual([{ id: "x" }]);
    expect(dropped).toEqual([]);
    expect(finalFindings).toHaveLength(1);
    expect(finalFindings[0]!.severity).toBe("error");
  });

  it("reinstates only the unmatched copy when one of two protected copies survives (#30)", () => {
    const c1 = makeFinding({
      id: "x",
      severity: "error",
      confidence: "low",
      evidence: { command: "cmd" },
    });
    const c2 = makeFinding({
      id: "x",
      severity: "error",
      confidence: "low",
      evidence: { command: "cmd" },
    });
    // Judge keeps exactly one adequate copy.
    const kept = makeFinding({ id: "x", severity: "error", confidence: "low" });
    const { finalFindings, reinstated, dropped } = reconcileCoordinator(
      [kept],
      [c1, c2],
      false,
      "review",
    );

    expect(finalFindings).toHaveLength(2);
    expect(reinstated).toHaveLength(1);
    expect(reinstated[0]!.id).toBe("x");
    expect(dropped).toEqual([]);
  });

  it("drops only the unmatched copy when one of two non-protected copies survives (#31)", () => {
    const c1 = makeFinding({ id: "x", severity: "warning", confidence: "low" });
    const c2 = makeFinding({ id: "x", severity: "warning", confidence: "low" });
    const kept = makeFinding({ id: "x", severity: "warning", confidence: "low" });
    const { finalFindings, reinstated, dropped } = reconcileCoordinator(
      [kept],
      [c1, c2],
      false,
      "review",
    );

    expect(finalFindings).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.id).toBe("x");
    expect(reinstated).toEqual([]);
  });

  it("drops the specialist for an id claimed by two distinct specialists (#48)", () => {
    const c1 = makeFinding({ id: "x", specialist: "bugs" });
    const c2 = makeFinding({ id: "x", specialist: "security" });
    const outcome = makeFinding({ id: "x" });
    const { finalFindings } = reconcileCoordinator([outcome], [c1, c2], false, "review");

    expect(finalFindings).toHaveLength(1);
    expect(finalFindings[0]!.specialist).toBeUndefined();
  });

  it("re-attributes the specialist by id, ignoring the model-supplied value", () => {
    const candidate = makeFinding({ id: "x", specialist: "bugs" });
    const outcome = makeFinding({ id: "x", specialist: "evil" });
    const { finalFindings } = reconcileCoordinator([outcome], [candidate], false, "review");

    expect(finalFindings[0]!.specialist).toBe("bugs");
  });

  it("re-stamps confidence from the verified candidates, overriding the judge", () => {
    const candidate = makeFinding({ id: "x", confidence: "high" });
    const outcome = makeFinding({ id: "x", confidence: "low" });
    const { finalFindings } = reconcileCoordinator([outcome], [candidate], true, "review");

    expect(finalFindings[0]!.confidence).toBe("high");
  });

  it("does not protect a colliding medium copy via another specialist's verify-high (#91)", () => {
    // Two distinct specialists collide on the same id (#48): bugs verified "high",
    // security only "medium". The judge keeps the bugs copy and drops the security one.
    const bugsHigh = makeFinding({ id: "x", specialist: "bugs", confidence: "high" });
    const securityMedium = makeFinding({ id: "x", specialist: "security", confidence: "medium" });
    const kept = makeFinding({ id: "x", specialist: "bugs", confidence: "high" });
    const { dropped } = reconcileCoordinator([kept], [bugsHigh, securityMedium], true, "review");

    // security's "medium" is not verify-high, so it is NOT protected. The judge's drop of it
    // must stand — bugs' "high" on the shared id must not leak protection onto it.
    expect(dropped.some((d) => d.specialist === "security")).toBe(true);
  });

  it("keeps a cross-cutting finding (no id match) with no specialist, un-audited", () => {
    const candidate = makeFinding({ id: "x", confidence: "low" });
    const crossCutting = makeFinding({ id: "new" });
    const { finalFindings, reinstated, dropped } = reconcileCoordinator(
      [candidate, crossCutting],
      [candidate],
      false,
      "review",
    );

    const newFinding = finalFindings.find((f) => f.id === "new");
    expect(newFinding).toBeDefined();
    expect(newFinding!.specialist).toBeUndefined();
    expect(reinstated.some((r) => r.id === "new")).toBe(false);
    expect(dropped.some((d) => d.id === "new")).toBe(false);
  });
});
