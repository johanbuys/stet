import type { Fixture } from "../fixture.js";

/**
 * in-diff fixture: potential divide-by-zero when the input array is empty.
 *
 * The added function divides `total` by `nums.length` without guarding against
 * an empty array — `NaN` is silently returned. The bug is fully visible in the
 * diff with no base-file context needed.
 */
export const inDiffDivideByZero: Fixture = {
  id: "in-diff-divide-by-zero",
  tier: "in-diff",
  clean: false,
  diff: `\
diff --git a/src/math.ts b/src/math.ts
--- a/src/math.ts
+++ b/src/math.ts
@@ -8,2 +8,5 @@

+export function average(nums: number[]): number {
+  const total = nums.reduce((a, b) => a + b, 0);
+  return total / nums.length; // NaN when nums is empty
+}
`,
  expected: [
    {
      id: "review.bug",
      severity: "warning",
      location: { file: "src/math.ts", line: 11 },
      gist: "Divide by zero when nums is empty: nums.length is 0, so total / nums.length returns NaN without an empty-array guard.",
    },
  ],
};
