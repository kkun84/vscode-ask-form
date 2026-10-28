import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"

interface Manifest {
  readonly packageManager: string
  readonly devDependencies: Readonly<Record<string, string>>
}

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as Manifest
const problems: Array<string> = []

const nixPlaywright = process.env["PLAYWRIGHT_NIX_VERSION"]
if (nixPlaywright !== undefined && manifest.devDependencies["@playwright/test"] !== nixPlaywright) {
  problems.push(`@playwright/test ${manifest.devDependencies["@playwright/test"]} がnixpkgsのPlaywright ${nixPlaywright} と違います`)
}

const pnpm = execFileSync("pnpm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).trim()
if (manifest.packageManager !== `pnpm@${pnpm}`) {
  problems.push(`packageManagerの${manifest.packageManager}と、使っているpnpm ${pnpm} が違います`)
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`)
  process.exitCode = 1
}
