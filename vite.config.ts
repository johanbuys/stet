import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
  test: {
    include: ["src/**/*.test.ts"],
  },
  pack: {
    entry: ["src/cli.ts"],
    format: ["esm"],
    // stet ships as a CLI binary (package.json `bin`), not an importable library —
    // there is no `types` field and no curated public API, so emitting .d.ts is dead
    // weight. Disabling it also avoids the tsdown dts step, which the globally-installed
    // vite-plus cannot run here (its dts generator fails to resolve the project's
    // typescript). The bundle itself builds and runs regardless.
    dts: false,
  },
});
