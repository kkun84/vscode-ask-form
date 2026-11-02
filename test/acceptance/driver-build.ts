import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { bundle } from "../../scripts/bundle.ts"

export const buildDriver = async (root: string, driver: string): Promise<void> => {
  const built = await bundle({ input: join(root, "test/acceptance/driver.ts"), platform: "node", format: "cjs" })
  await mkdir(driver, { recursive: true })
  await writeFile(join(driver, "driver.cjs"), built.code)
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
