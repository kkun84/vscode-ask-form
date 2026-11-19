import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { reviewFindings, reviewSettingChanges, type MutationReport } from "./mutation-report.ts"

const path = ".mutator/report/mutation.json"

const load = async (): Promise<MutationReport | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as MutationReport
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined
    }
    throw error
  }
}

const base = process.argv[2]
const changed = base === undefined ? [] : execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n")
const review = reviewFindings(await load(), path)
process.stdout.write(`${[...reviewSettingChanges(changed), ...review.lines].join("\n")}\n`)
process.exitCode = review.exitCode
