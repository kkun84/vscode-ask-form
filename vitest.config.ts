import { defineConfig } from "vitest/config"

const tier = (name: string, testTimeout: number, exclude: ReadonlyArray<string> = []) => ({
  test: { name, include: [`test/${name}/**/*.test.ts`], exclude: ["**/node_modules/**", ...exclude], testTimeout }
})

const mutationDiff = "test/system/mutation-diff.test.ts"

export default defineConfig({
  test: {
    projects: [
      tier("unit", 5000),
      tier("architecture", 10_000),
      tier("system", 5000, [mutationDiff]),
      { test: { name: "mutation", include: [mutationDiff], testTimeout: 600_000 } }
    ]
  }
})
