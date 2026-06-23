import type { Fixture } from "../fixture.js";

/**
 * clean fixture: a pure local-variable rename with no defects.
 *
 * A single-character variable `r` is renamed to `config` for readability.
 * No logic changes — any finding emitted against this diff is a false positive.
 */
export const cleanRename: Fixture = {
  id: "clean-rename",
  tier: "in-diff",
  clean: true,
  diff: `\
diff --git a/src/parser.ts b/src/parser.ts
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -14,5 +14,5 @@
 export function parseConfig(raw: string) {
-  const r = JSON.parse(raw) as Config;
-  return r;
+  const config = JSON.parse(raw) as Config;
+  return config;
 }
`,
  expected: [],
};
