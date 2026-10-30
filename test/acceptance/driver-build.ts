import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { build } from "esbuild"

export const buildDriver = async (root: string, driver: string): Promise<void> => {
  await build({
    entryPoints: [join(root, "test/acceptance/driver.ts")],
    outfile: join(driver, "driver.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    logLevel: "warning"
  })
  await mkdir(driver, { recursive: true })
  await writeFile(
    join(driver, "package.json"),
    JSON.stringify({
      name: "ask-form-e2e-driver",
      publisher: "kkun84",
      version: "0.0.0",
      engines: { vscode: "^1.110.0" },
      main: "./driver.cjs",
      activationEvents: ["onStartupFinished"],
      contributes: { commands: [{ command: "ask-form-e2e.newChat", title: "Ask Form: New acceptance chat" }] }
    })
  )
}
