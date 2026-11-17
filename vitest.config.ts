import { defineConfig } from "vitest/config"

const tier = (name: string, testTimeout: number) => ({
  test: { name, include: [`test/${name}/**/*.test.ts`], testTimeout }
})

export default defineConfig({
  test: {
    projects: [tier("unit", 5000), tier("integration", 10_000), tier("system", 5000)]
  }
})
