import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bundle } from "./bundle.ts"
import { runChat } from "../test/acceptance/chat.ts"
import { buildDriver } from "../test/acceptance/driver-build.ts"
import { runWeb } from "../test/acceptance/web-browser.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const extension = join(root, "out/extension")
const out = join(extension, "acceptance")
const driver = join(root, "out/e2e-driver")
const targets = process.argv.slice(2).length === 0 ? ["desktop", "web", "chat"] : process.argv.slice(2)

const emit = async (input: string, platform: "node" | "browser", file: string): Promise<void> => {
  const built = await bundle({ input: join(root, input), platform, format: "cjs" })
  await mkdir(out, { recursive: true })
  await writeFile(join(out, file), built.code)
}

await Promise.all([
  emit("test/acceptance/desktop.ts", "node", "desktop.cjs"),
  emit("test/acceptance/web.ts", "browser", "web.js"),
  buildDriver(root, driver)
])

const desktop = async (): Promise<void> => {
  const executable = process.env["VSCODE_EXECUTABLE"]
  if (executable === undefined) {
    throw new Error("VSCODE_EXECUTABLE is not set. Run inside `nix develop .#acceptance`.")
  }
  const profile = await mkdtemp(join(tmpdir(), "ask-form-"))
  const env = { ...process.env }
  delete env["ELECTRON_RUN_AS_NODE"]
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        `--extensionDevelopmentPath=${extension}`,
        `--extensionTestsPath=${join(out, "desktop.cjs")}`,
        `--user-data-dir=${join(profile, "user")}`,
        `--extensions-dir=${join(profile, "extensions")}`,
        "--disable-extensions",
        "--disable-workspace-trust",
        "--disable-gpu",
        "--no-sandbox",
        "--skip-welcome",
        "--skip-release-notes"
      ],
      { stdio: "inherit", env }
    )
    child.on("error", reject)
    child.on("exit", resolve)
  })
  if (code !== 0) {
    throw new Error(`desktop acceptance tests failed with exit code ${code}`)
  }
}

const web = (): Promise<void> =>
  runWeb({ electron: electron(), extension, tests: join(out, "web.js"), results: join(root, "test-results/web") })

const electron = (): string => {
  const executable = process.env["VSCODE_ELECTRON"]
  if (executable === undefined) {
    throw new Error("VSCODE_ELECTRON is not set. Run inside `nix develop .#acceptance`.")
  }
  return executable
}

const chat = (): Promise<void> => runChat({ executable: electron(), extension, driver, results: join(root, "test-results/chat") })

const runners: Readonly<Record<string, () => Promise<void>>> = { desktop, web, chat }

for (const target of targets) {
  const runner = runners[target]
  if (runner === undefined) {
    throw new Error(`unknown target ${target}`)
  }
  await runner()
}
