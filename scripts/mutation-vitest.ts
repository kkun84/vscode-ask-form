import { loadConfig } from "@mizchi/mutator"
import { createVitest, type Vitest } from "vitest/node"

export interface MutatorSettings {
  readonly vitestConfig?: string | undefined
  readonly include?: ReadonlyArray<string> | undefined
  readonly exclude?: ReadonlyArray<string> | undefined
  readonly timeBudget?: number | undefined
  readonly mutantsPerLine?: number | undefined
  readonly shard?: string | undefined
}

export const mutatorSettings = async (root: string): Promise<MutatorSettings> => (await loadConfig(root))?.config ?? {}

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
