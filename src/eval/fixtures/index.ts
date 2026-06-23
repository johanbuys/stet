/**
 * All hand-authored eval fixtures.
 *
 * Covers: in-diff (2), needs-context (1), cross-file (1), clean (1).
 * Extend this array as new fixtures are added; do NOT reorder (cassette
 * replay depends on fixture ids, not positions, but stable ordering helps diffs).
 */

import type { Fixture } from "../fixture.js";
import { inDiffOffByOne } from "./in-diff-off-by-one.js";
import { inDiffDivideByZero } from "./in-diff-divide-by-zero.js";
import { needsContextWrongArgOrder } from "./needs-context-wrong-arg-order.js";
import { crossFileBrokenImport } from "./cross-file-broken-import.js";
import { cleanRename } from "./clean-rename.js";

export const ALL_FIXTURES: readonly Fixture[] = [
  inDiffOffByOne,
  inDiffDivideByZero,
  needsContextWrongArgOrder,
  crossFileBrokenImport,
  cleanRename,
];
