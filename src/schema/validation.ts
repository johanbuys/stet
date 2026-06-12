/**
 * Shared TypeBox validation-error formatting.
 *
 * One home for the "first N errors as `path: message; …`" rendering so config
 * errors (src/config/load.ts) and report errors (parseRunReport) stay consistent
 * instead of drifting as independent copies.
 */

import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export interface SchemaErrorDetail {
  path: string;
  message: string;
}

/**
 * Collect the first `max` validation errors for `value` against `schema`.
 * `details` is the human-readable one-liner; `errors` the structured form
 * (e.g. for SchemaError.errors).
 */
export function collectSchemaErrors(
  schema: TSchema,
  value: unknown,
  max = 3,
): { details: string; errors: SchemaErrorDetail[] } {
  const errors = [...Value.Errors(schema, value)]
    .slice(0, max)
    .map((e) => ({ path: e.path, message: e.message }));
  const details = errors.map((e) => `${e.path || "/"}: ${e.message}`).join("; ");
  return { details, errors };
}
