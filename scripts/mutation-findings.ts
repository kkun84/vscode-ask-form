import { readFile } from "node:fs/promises"
import { reviewFindings, type MutationReport } from "./mutation-report.ts"

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

const review = reviewFindings(await load(), path)
process.stdout.write(`${review.lines.join("\n")}\n`)
process.exitCode = review.exitCode
