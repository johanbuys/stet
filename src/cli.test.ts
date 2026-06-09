import { Result } from "better-result";
import { describe, expect, it } from "vite-plus/test";
import { BudgetError, ConfigError, RoutingError, ScopeError, type StetError } from "./errors.js";
import { resolveExit } from "./cli.js";

describe("resolveExit", () => {
  describe("Ok path: passes through the report's exit code", () => {
    it("Ok with exitCode 0 → { exitCode: 0 }, no stderr", () => {
      const result = Result.ok({ exitCode: 0 as const });
      const out = resolveExit(result);
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toBeUndefined();
    });

    it("Ok with exitCode 1 → { exitCode: 1 }, no stderr", () => {
      const result = Result.ok({ exitCode: 1 as const });
      const out = resolveExit(result);
      expect(out.exitCode).toBe(1);
      expect(out.stderr).toBeUndefined();
    });
  });

  describe("Err paths: all taxonomy variants map to exitCode 2 with a human message", () => {
    it("ConfigError → exitCode 2, message includes path", () => {
      const err = new ConfigError({
        path: "/repo/stet.config.yml",
        message: "unknown key: phases.review.enabled",
      });
      const result: Result<{ exitCode: 0 | 1 }, StetError> = Result.err(err);
      const out = resolveExit(result);
      expect(out.exitCode).toBe(2);
      expect(out.stderr).toContain("/repo/stet.config.yml");
      expect(out.stderr).toContain("unknown key: phases.review.enabled");
    });

    it("ScopeError → exitCode 2, message in stderr", () => {
      const err = new ScopeError({ message: "nothing detectable in working tree" });
      const result: Result<{ exitCode: 0 | 1 }, StetError> = Result.err(err);
      const out = resolveExit(result);
      expect(out.exitCode).toBe(2);
      expect(out.stderr).toContain("nothing detectable in working tree");
    });

    it("RoutingError with tier → exitCode 2, message includes tier", () => {
      const err = new RoutingError({
        tier: "robust",
        message: "no provider credentialed for tier",
      });
      const result: Result<{ exitCode: 0 | 1 }, StetError> = Result.err(err);
      const out = resolveExit(result);
      expect(out.exitCode).toBe(2);
      expect(out.stderr).toContain("robust");
      expect(out.stderr).toContain("no provider credentialed for tier");
    });

    it("RoutingError without tier → exitCode 2, message in stderr", () => {
      const err = new RoutingError({ message: "model unavailable" });
      const result: Result<{ exitCode: 0 | 1 }, StetError> = Result.err(err);
      const out = resolveExit(result);
      expect(out.exitCode).toBe(2);
      expect(out.stderr).toContain("model unavailable");
    });

    it("BudgetError → exitCode 2, message includes limit name", () => {
      const err = new BudgetError({
        limit: "wallClockMs",
        message: "phase exceeded 5-minute wall-clock budget",
      });
      const result: Result<{ exitCode: 0 | 1 }, StetError> = Result.err(err);
      const out = resolveExit(result);
      expect(out.exitCode).toBe(2);
      expect(out.stderr).toContain("wallClockMs");
      expect(out.stderr).toContain("phase exceeded 5-minute wall-clock budget");
    });
  });
});
