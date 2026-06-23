import type { Fixture } from "../fixture.js";

/**
 * in-diff fixture: off-by-one error accessing the last element of an array.
 *
 * The bug (`arr[arr.length]` → always `undefined`) is visible on the added line
 * in the diff; no base-file context needed.
 */
export const inDiffOffByOne: Fixture = {
  id: "in-diff-off-by-one",
  tier: "in-diff",
  clean: false,
  diff: `\
diff --git a/src/utils/array.ts b/src/utils/array.ts
new file mode 100644
--- /dev/null
+++ b/src/utils/array.ts
@@ -0,0 +1,6 @@
+/**
+ * Returns the last element of an array.
+ */
+export function last<T>(arr: T[]): T | undefined {
+  return arr[arr.length]; // off-by-one: should be arr.length - 1
+}
`,
  expected: [
    {
      id: "review.bug",
      severity: "error",
      location: { file: "src/utils/array.ts", line: 5 },
      gist: "Off-by-one: arr[arr.length] is always undefined; the last element is at index arr.length - 1.",
    },
  ],
};
