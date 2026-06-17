/**
 * Scope schema — single source of truth for the Scope shape.
 *
 * Unifies three previous locations:
 *   - TS interface in src/scope.ts
 *   - Inline TypeBox literal in RunReport's scope block (src/schema/report.ts)
 *   - Field-by-field re-projection in assembleReport (src/report.ts)
 *
 * PRD refs: §4.5 (RunReport scope), §3.6 (scope detection), decision #33 (stripped field).
 *
 * `stripped` is set by M8 pre-filtering, never by detectScope. It is optional so that
 * M1–M7 reports remain valid without it.
 *
 * No circular imports: this module imports only from @sinclair/typebox.
 */

import { type Static, Type } from "@sinclair/typebox";

/**
 * TypeBox schema for the resolved scope.
 * Same-name value+type merging (established pattern — see src/schema/finding.ts).
 */
export const Scope = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("staged"),
      Type.Literal("working"),
      Type.Literal("against"),
      Type.Literal("commit"),
      Type.Literal("commits"),
    ]),
    ref: Type.Optional(Type.String()),
    /**
     * The raw commit-range string (e.g. "HEAD~3..HEAD"). Set ONLY for the
     * "commits" kind so the diff fetch (`getScopeDiff`) can recover the range —
     * `ref` is unused for ranges. Optional like `stripped`, so it never breaks
     * pre-existing reports.
     */
    range: Type.Optional(Type.String()),
    files: Type.Array(Type.String()),
    /**
     * Paths removed by semantic pre-filtering (§3.6, decision #33).
     * Set by M8; never set by detectScope. Optional so pre-M8 reports are valid.
     */
    stripped: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export type Scope = Static<typeof Scope>;
