import type { Fixture } from "../fixture.js";

/**
 * cross-file fixture: a renamed export breaks an import in a different file.
 *
 * The diff renames `DEFAULT_TIMEOUT` → `DEFAULT_REQUEST_TIMEOUT` in `src/config.ts`,
 * but `src/api.ts` in baseFiles still imports the old name. The breakage only shows
 * up when both files are read together — it cannot be detected from the diff alone.
 */
export const crossFileBrokenImport: Fixture = {
  id: "cross-file-broken-import",
  tier: "cross-file",
  clean: false,
  diff: `\
diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,4 +1,4 @@
 /** Milliseconds before an outbound request is abandoned. */
-export const DEFAULT_TIMEOUT = 5_000;
+export const DEFAULT_REQUEST_TIMEOUT = 5_000;
`,
  baseFiles: {
    "src/api.ts": `\
import { DEFAULT_TIMEOUT } from "./config.js";

export async function fetchUser(id: string) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  const res = await fetch(\`/users/\${id}\`, { signal: controller.signal });
  return res.json();
}
`,
  },
  expected: [
    {
      id: "review.bug",
      severity: "error",
      location: { file: "src/api.ts", line: 1 },
      gist: "src/api.ts imports DEFAULT_TIMEOUT which no longer exists after the rename to DEFAULT_REQUEST_TIMEOUT in src/config.ts — the import will fail at runtime.",
    },
  ],
};
