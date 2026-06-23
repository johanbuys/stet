/**
 * Fixture type for the code-review eval suite (TDD C·4 / PRD C5).
 *
 * A fixture pairs a unified diff with the findings a good reviewer *should* produce,
 * plus optional base-file context for needs-context / cross-file tiers.
 *
 * Consumed by the grader (T9) and the eval runner (T10+).
 * The grader buckets each emitted finding as HIT / VALID / NOISE by matching
 * against `expected` via location gate (±N lines) + embedding similarity, 1-to-1.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Severity } from "../schema/finding.js";

// ---------------------------------------------------------------------------
// ExpectedFinding — ground-truth entry for the grader
// ---------------------------------------------------------------------------

/**
 * A ground-truth defect that a good reviewer should surface.
 * Lighter than the full `Finding` schema: no `phase`, `specialist`, `confidence`
 * (harness-stamped at runtime); `gist` replaces `message` to signal it's a
 * human-authored descriptor, not a model output.
 */
export const ExpectedFinding = Type.Object(
  {
    /** Stable rule id matching the expected phase-namespaced id (e.g. "review.bug"). */
    id: Type.String(),
    severity: Severity,
    location: Type.Optional(
      Type.Object(
        {
          file: Type.String(),
          line: Type.Optional(Type.Number()),
        },
        { additionalProperties: false },
      ),
    ),
    /** Human-authored description of the defect — used by the LLM-judge for embedding match. */
    gist: Type.String(),
  },
  { additionalProperties: false },
);

export type ExpectedFinding = Static<typeof ExpectedFinding>;

// ---------------------------------------------------------------------------
// FixtureTier — visibility tiers (C·3 metrics)
// ---------------------------------------------------------------------------

export const FixtureTier = Type.Union([
  Type.Literal("in-diff"),
  Type.Literal("needs-context"),
  Type.Literal("cross-file"),
]);

export type FixtureTier = Static<typeof FixtureTier>;

// ---------------------------------------------------------------------------
// Fixture — the top-level eval record
// ---------------------------------------------------------------------------

/**
 * A single eval fixture: a change under review paired with ground-truth expectations.
 *
 * `tier` governs which precision/recall bucket the fixture counts toward (C·3).
 * `clean: true` means no defects — any finding the reviewer emits is a false positive;
 *   clean fixtures contribute to the FPR metric, not P/R.
 * `baseFiles` holds file contents (path → text) needed for context that the diff
 *   alone does not supply; required for `needs-context` and `cross-file` fixtures.
 * `sensitivePaths: true` signals the fixture involves auth/crypto/migration paths,
 *   which triggers the `security` specialist (Area E).
 */
export const Fixture = Type.Object(
  {
    /** Unique fixture id, kebab-case. */
    id: Type.String(),
    /** Unified diff (net-vs-base). */
    diff: Type.String(),
    /** Base file contents keyed by path. Required for needs-context / cross-file fixtures. */
    baseFiles: Type.Optional(Type.Record(Type.String(), Type.String())),
    /** Ground-truth defects the grader uses for HIT matching. Empty for clean fixtures. */
    expected: Type.Array(ExpectedFinding),
    /** True ⇒ bug-free fixture; any emitted finding is a false positive (FPR guard). */
    clean: Type.Boolean(),
    tier: FixtureTier,
    /** True ⇒ fixture touches sensitive paths (auth/crypto/migrations); activates security specialist. */
    sensitivePaths: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type Fixture = Static<typeof Fixture>;
