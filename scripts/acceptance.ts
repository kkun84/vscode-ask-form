import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { build } from "esbuild"
import { runTests } from "@vscode/test-web"
import { runChat } from "../test/acceptance/chat.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const extension = join(root, "out/extension")
const out = join(extension, "acceptance")
const driver = join(root, "out/e2e-driver")
const targets = process.argv.slice(2).length === 0 ? ["desktop", "web", "chat"] : process.argv.slice(2)

await Promise.all([
  build({
    entryPoints: [join(root, "test/acceptance/desktop.ts")],
    outfile: join(out, "desktop.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    logLevel: "warning"
  }),
  build({
    entryPoints: [join(root, "test/acceptance/web.ts")],
    outfile: join(out, "web.js"),
    bundle: true,
    platform: "browser",
    format: "cjs",
    external: ["vscode"],
    logLevel: "warning"
  }),
  build({
    entryPoints: [join(root, "test/acceptance/driver.ts")],
    outfile: join(driver, "driver.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    logLevel: "warning"
  })
])

await mkdir(driver, { recursive: true })
await writeFile(
  join(driver, "package.json"),
  JSON.stringify({
    name: "ask-form-e2e-driver",
    publisher: "kkun84",
    version: "0.0.0",
    engines: { vscode: "^1.110.0" },
    main: "./driver.cjs",
    activationEvents: ["onStartupFinished"]
  })
)

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
  runTests({
    browserType: "chromium",
    quality: "stable",
    headless: true,
    extensionDevelopmentPath: extension,
    extensionTestsPath: join(out, "web.js")
  })

const chat = (): Promise<void> => {
  const executable = process.env["VSCODE_ELECTRON"]
  if (executable === undefined) {
    throw new Error("VSCODE_ELECTRON is not set. Run inside `nix develop .#acceptance`.")
  }
  return runChat({ executable, extension, driver, results: join(root, "test-results/chat") })
}

const runners: Readonly<Record<string, () => Promise<void>>> = { desktop, web, chat }

for (const target of targets) {
  const runner = runners[target]
  if (runner === undefined) {
    throw new Error(`unknown target ${target}`)
  }
  await runner()
}
