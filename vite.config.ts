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
    dts: true,
  },
});
