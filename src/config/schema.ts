/**
 * Config schema (TypeBox) + built-in defaults.
 *
 * PRD refs: §3.7 (config), §4.9 (schema); plan M5.
 *
 * - Top-level unknown keys pass through (forward compat; T18 turns them into a warning finding).
 * - `phases.<id>` values are `unknown` — each phase validates its own slice.
 * - `output.failOn` is validated here because the CLI reads it before dispatching to phases.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Severity } from "../schema/finding.js";

export const StetConfig = Type.Object(
  {
    phases: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    output: Type.Optional(
      Type.Object(
        {
          failOn: Type.Optional(Severity),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);

export type StetConfig = Static<typeof StetConfig>;

/**
 * The lowest-priority layer; every setting here is overridden by any explicit config.
 *
 * Typed with `satisfies` (not `: StetConfig`) so consumers see the literal shape —
 * `BUILT_IN_DEFAULTS.output.failOn` is the single source of truth for the default
 * gating severity (the CLI references it instead of repeating the literal).
 */
export const BUILT_IN_DEFAULTS = {
  output: {
    failOn: "error",
  },
} as const satisfies StetConfig;
