import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "vitest"
import { vitestFiles } from "../../scripts/vitest-files.ts"

const root = join("/", "repo")

test("DES-TOOLS-004 Vitestの設定ファイルとsetupFilesとglobalSetupを、根からの相対の位置で重ねずに並べる", () => {
  assert.deepEqual(
    vitestFiles(root, [
      {
        configFile: join(root, "vitest.mutation.config.ts"),
        setupFiles: [join(root, "test", "setup.ts")],
        globalSetup: join(root, "test", "global.ts")
      },
      { configFile: join(root, "vitest.mutation.config.ts"), setupFiles: [], globalSetup: [join(root, "a-global.ts")] }
    ]),
    ["a-global.ts", "test/global.ts", "test/setup.ts", "vitest.mutation.config.ts"]
  )
})

test("DES-TOOLS-004 根の外とnode_modulesと相対の位置のファイルは写さない", () => {
  assert.deepEqual(
    vitestFiles(root, [
      {
        configFile: false,
        setupFiles: [join("/", "elsewhere", "setup.ts"), join(root, "node_modules", "pkg", "setup.js"), "relative/setup.ts", root],
        globalSetup: undefined
      }
    ]),
    []
  )
})
