import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { checkChangelog } from "./release.ts"

const ref = process.argv[2]
const base = ref === undefined ? undefined : execFileSync("git", ["show", `${ref}:CHANGELOG.md`], { encoding: "utf8" })
const problems = checkChangelog(await readFile("CHANGELOG.md", "utf8"), base)
if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`)
  process.exitCode = 1
}
