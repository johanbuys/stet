import type { Fixture } from "../fixture.js";

/**
 * clean fixture: extracting a magic number into a named constant.
 *
 * The change replaces the inline literal `30_000` with `DEFAULT_TIMEOUT_MS`
 * for readability. No logic change — any finding emitted against this diff
 * is a false positive.
 */
export const cleanConstantExtraction: Fixture = {
  id: "clean-constant-extraction",
  tier: "in-diff",
  clean: true,
  diff: `\
diff --git a/src/timeout.ts b/src/timeout.ts
--- a/src/timeout.ts
+++ b/src/timeout.ts
@@ -1,6 +1,8 @@
+const DEFAULT_TIMEOUT_MS = 30_000;
+
 export function createTimeoutController(ms?: number): AbortController {
   const controller = new AbortController();
-  setTimeout(() => controller.abort(), ms ?? 30_000);
+  setTimeout(() => controller.abort(), ms ?? DEFAULT_TIMEOUT_MS);
   return controller;
 }
`,
  expected: [],
};
