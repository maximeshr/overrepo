import { qualityGate } from "quality-gate/vite";
import { defineConfig } from "vite-plus";

// OKQ base config (lint, fmt, test coverage, staged); only overrepo's structure is added here.
export default defineConfig({
  ...qualityGate,
  pack: {
    entry: ["src/index.ts", "src/cli.ts"],
    deps: {
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
    },
  },
  test: {
    ...qualityGate.test,
    include: ["tests/**/*.test.ts"],
    // Integration tests create real git repositories.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
