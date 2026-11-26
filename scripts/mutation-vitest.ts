import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createVitest, type Vitest } from "vitest/node"

export interface MutatorSettings {
  readonly vitestConfig?: string
  readonly include?: ReadonlyArray<string>
  readonly exclude?: ReadonlyArray<string>
}

export const mutatorSettings = (root: string): MutatorSettings => {
  const path = resolve(root, "mutator.config.json")
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as MutatorSettings) : {}
}

export const withMutationVitest = async (settings: MutatorSettings, body: (vitest: Vitest) => string | Promise<string>): Promise<void> => {
  const vitest = await createVitest(
    "test",
    { watch: false, run: true, ...(settings.vitestConfig === undefined ? {} : { config: settings.vitestConfig }) },
    { logLevel: "silent" }
  )
  try {
    process.stdout.write(await body(vitest))
  } finally {
    await vitest.close()
  }
}
