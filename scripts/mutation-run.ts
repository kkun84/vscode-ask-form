import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeReport, type MutationReport, type Review } from "./mutation-report.ts"

export type Ran = { readonly report: MutationReport; readonly stdout: string } | { readonly problem: string }

export const runMutator = (args: ReadonlyArray<string>, directory: string, cwd = process.cwd()): Ran => {
  const result = spawnSync("pnpm", ["exec", "mutator", ...args, "--reporter", "text", "--reporter", "json", "--report-dir", directory], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "" }
  })
  const path = join(directory, "mutation.json")
  if (result.status !== 0 || !existsSync(path)) {
    process.stderr.write(`${result.stdout}\n${result.stderr}\n`)
    return { problem: `mutator ${args.slice(0, 4).join(" ")}が失敗しました。上の出力を確かめてください。` }
  }
  try {
    const decoded = decodeReport(JSON.parse(readFileSync(path, "utf8")))
    return "report" in decoded
      ? { report: decoded.report, stdout: result.stdout }
      : { problem: `${path}は想定したmutatorのレポートではありません: ${decoded.problem}` }
  } catch (error) {
    return { problem: `${path}を読めません: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export const emit = (review: Review) => {
  if (review.lines.length > 0) {
    process.stdout.write(`${review.lines.join("\n")}\n`)
  }
  process.exitCode = review.exitCode
}
