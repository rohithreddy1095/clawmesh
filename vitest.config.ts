import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.live.test.ts", "**/*.e2e.test.ts", "node_modules/**"],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    pool: "forks",
    maxWorkers: 4,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
