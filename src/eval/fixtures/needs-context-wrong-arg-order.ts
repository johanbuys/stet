import type { Fixture } from "../fixture.js";

/**
 * needs-context fixture: arguments passed in the wrong order to formatCurrency.
 *
 * The diff adds a call `formatCurrency(price, "USD")`, but the function signature
 * in the base file is `formatCurrency(currency: string, amount: number)` — so the
 * first arg should be the currency string and the second the numeric amount.
 * The bug requires reading `src/format.ts` from baseFiles to detect.
 */
export const needsContextWrongArgOrder: Fixture = {
  id: "needs-context-wrong-arg-order",
  tier: "needs-context",
  clean: false,
  diff: `\
diff --git a/src/invoice.ts b/src/invoice.ts
--- a/src/invoice.ts
+++ b/src/invoice.ts
@@ -6,2 +6,9 @@
 import { formatCurrency } from "./format.js";

+/**
+ * Formats a single invoice line item with its price.
+ */
+export function printInvoiceLine(item: string, price: number): string {
+  const formatted = formatCurrency(price, "USD");
+  return \`\${item}: \${formatted}\`;
+}
`,
  baseFiles: {
    "src/format.ts": `\
/**
 * Format a numeric amount as a currency string.
 * @param currency - ISO 4217 code (e.g. "USD", "EUR")
 * @param amount   - the numeric value to format
 */
export function formatCurrency(currency: string, amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}
`,
  },
  expected: [
    {
      id: "review.bug",
      severity: "error",
      location: { file: "src/invoice.ts", line: 12 },
      gist: 'Arguments are in the wrong order: formatCurrency expects (currency: string, amount: number) but is called with (price, "USD") — the numeric amount is passed as the first argument.',
    },
  ],
};
