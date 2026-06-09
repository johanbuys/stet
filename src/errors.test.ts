import { Result } from "better-result";
import { describe, expect, it } from "vite-plus/test";
import { BudgetError, ConfigError, RoutingError, SchemaError, ScopeError } from "./errors.js";

describe("error taxonomy", () => {
  it("ScopeError carries _tag and message", () => {
    const err = new ScopeError({ message: "no staged changes" });
    expect(err._tag).toBe("ScopeError");
    expect(err.message).toBe("no staged changes");
  });

  it("ConfigError carries _tag, path, and message", () => {
    const err = new ConfigError({
      path: "/project/stet.config.yml",
      message: "unknown key: phases.review.enabled",
    });
    expect(err._tag).toBe("ConfigError");
    expect(err.path).toBe("/project/stet.config.yml");
    expect(err.message).toBe("unknown key: phases.review.enabled");
  });

  it("RoutingError carries _tag and message; tier is optional", () => {
    const withTier = new RoutingError({
      tier: "robust",
      message: "no provider for tier",
    });
    expect(withTier._tag).toBe("RoutingError");
    expect(withTier.tier).toBe("robust");
    expect(withTier.message).toBe("no provider for tier");

    const withoutTier = new RoutingError({ message: "model unavailable" });
    expect(withoutTier._tag).toBe("RoutingError");
    expect(withoutTier.tier).toBeUndefined();
  });

  it("BudgetError carries _tag, limit, and message", () => {
    const err = new BudgetError({
      limit: "wallClockMs",
      message: "phase exceeded 5-minute wall-clock budget",
    });
    expect(err._tag).toBe("BudgetError");
    expect(err.limit).toBe("wallClockMs");
    expect(err.message).toBe("phase exceeded 5-minute wall-clock budget");
  });

  it("SchemaError carries _tag, message, and errors array", () => {
    const err = new SchemaError({
      message: "RunReport validation failed — /version: expected 1",
      errors: [{ path: "/version", message: "expected 1" }],
    });
    expect(err._tag).toBe("SchemaError");
    expect(err.message).toBe("RunReport validation failed — /version: expected 1");
    expect(err.errors).toHaveLength(1);
    expect(err.errors[0]).toEqual({ path: "/version", message: "expected 1" });
  });

  it("SchemaError is detectable via isErr() and _tag in a Result", () => {
    const fail = (): Result<string, SchemaError> =>
      Result.err(
        new SchemaError({
          message: "bad schema",
          errors: [{ path: "/phases", message: "not an array" }],
        }),
      );

    const result = fail();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
      expect(result.error.errors[0]?.path).toBe("/phases");
    }
  });

  it("ScopeError is detectable via isErr() and _tag in a Result", () => {
    const fail = (): Result<string, ScopeError> =>
      Result.err(new ScopeError({ message: "nothing detectable" }));

    const result = fail();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ScopeError");
      expect(result.error.message).toBe("nothing detectable");
    }
  });
});
