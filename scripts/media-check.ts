import { execFileSync } from "node:child_process"
import { checkMedia } from "./media-rules.ts"

const base = process.argv[2] ?? "origin/main"
const changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" })
  .split("\n")
  .filter((line) => line !== "")
const problems = checkMedia(changed)
if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`)
  process.exitCode = 1
}
