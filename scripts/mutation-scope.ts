import { globSync, statSync } from "node:fs"
import { relative, resolve, sep } from "node:path"
import { mutatorSettings, withMutationVitest } from "./mutation-vitest.ts"

const defaultInclude = ["src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"]
const defaultExclude = ["**/node_modules/**", "**/*.d.ts", "**/*.{test,spec}.*", "**/__tests__/**"]

const root = process.cwd()
const settings = mutatorSettings(root)
const portable = (file: string) => file.split(sep).join("/")

const sources = globSync([...(settings.include ?? defaultInclude)], {
  cwd: root,
  exclude: [...defaultExclude, ...(settings.exclude ?? [])]
})
  .filter((file) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file) && statSync(resolve(root, file)).isFile())
  .map((file) => portable(file))
  .toSorted()

await withMutationVitest(settings, async (vitest) => {
  const tests = [
    ...new Set((await vitest.globTestSpecifications()).map((specification) => portable(relative(root, specification.moduleId))))
  ].toSorted()
  return `${JSON.stringify({ tests, sources })}\n`
})
