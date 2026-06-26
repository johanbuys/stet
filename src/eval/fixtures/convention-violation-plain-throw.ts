import type { Fixture } from "../fixture.js";

/**
 * needs-context fixture: convention violation — plain new Error() instead of AppError.
 *
 * The diff adds a function that throws `new Error()`, violating the project's
 * CLAUDE.md mandate to use `AppError` for all thrown errors. The convention is in
 * baseFiles (CLAUDE.md) and must be read to detect the violation.
 *
 * Tests AC#11: a good reviewer quotes the exact CLAUDE.md rule + the offending line.
 */
export const conventionViolationPlainThrow: Fixture = {
  id: "convention-violation-plain-throw",
  tier: "needs-context",
  clean: false,
  diff: `\
diff --git a/src/session.ts b/src/session.ts
--- a/src/session.ts
+++ b/src/session.ts
@@ -1,5 +1,15 @@
 import { readFile, writeFile } from "node:fs/promises";
+import { join } from "node:path";

+/**
+ * Resolves and validates the session directory path.
+ * Throws if the base directory is missing.
+ */
+export function resolveSessionDir(base: string, id: string): string {
+  if (!base) {
+    throw new Error("base directory must not be empty");
+  }
+  return join(base, id);
+}
+
 export async function loadSession(path: string) {
`,
  baseFiles: {
    "CLAUDE.md": `# Error Handling (Required)

**Never throw \`new Error()\` in production code.** All errors must use the project \`AppError\` class
so that the CLI shell can match them into exit codes.

\`\`\`ts
import { AppError } from "./errors.js";
throw new AppError("SessionIO", "base directory must not be empty");
\`\`\`

Any function that can fail must return \`Result<T, E>\` and never throw across a module boundary.
`,
  },
  expected: [
    {
      id: "review.bug",
      severity: "warning",
      location: { file: "src/session.ts", line: 9 },
      gist: 'Convention violation (CLAUDE.md §Error Handling): `throw new Error()` is forbidden; must use AppError. The line `throw new Error("base directory must not be empty")` breaks the rule.',
    },
  ],
};
