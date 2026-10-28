import { spawnSync } from "node:child_process"

const located = spawnSync("effect-tsgo", ["get-exe-path"], { encoding: "utf8", shell: process.platform === "win32" })
const tsgo = located.stdout.trim().split("\n").at(-1) ?? ""

const failed = ["tsconfig.json", "tsconfig.browser.json"].filter(
  (project) => spawnSync(tsgo, ["-p", project], { stdio: "inherit" }).status !== 0
)

process.exitCode = failed.length === 0 && located.status === 0 ? 0 : 1
