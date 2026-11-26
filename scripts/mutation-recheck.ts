import { spawnSync } from "node:child_process"
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { decodeReport, failure, type MutationReport, type Review } from "./mutation-report.ts"
import { reviewPending, reviewRerun, reviewTruncation, snapshotRows, unselectedCandidates } from "./mutation-rerun.ts"
import { mutatorSettings } from "./mutation-vitest.ts"

const [work = ""] = process.argv.slice(2)

const load = (path: string): MutationReport | undefined => {
  if (!existsSync(path)) {
    return undefined
  }
  const decoded = decodeReport(JSON.parse(readFileSync(path, "utf8")))
  return "report" in decoded ? decoded.report : undefined
}

const rows = (path: string) => snapshotRows(existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined)

const rerun = (keys: ReadonlyArray<string>): MutationReport | Review => {
  const held = join(work, "held-mutator")
  const directory = join(work, "rerun")
  cpSync(".mutator", held, { recursive: true })
  try {
    rmSync(".mutator", { recursive: true, force: true })
    const result = spawnSync(
      "pnpm",
      ["exec", "mutator", ...keys.flatMap((key) => ["--only", key]), "--kill-matrix", "--reporter", "json", "--report-dir", directory],
      { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } }
    )
    const report = load(join(directory, "mutation.json"))
    if (result.status !== 0 || report === undefined) {
      process.stderr.write(`${result.stdout}\n${result.stderr}\n`)
      return failure("実行し直せない", `ミュータント${keys.join("、")}を実行し直せませんでした。上の出力を確かめてください。`)
    }
    return report
  } finally {
    rmSync(".mutator", { recursive: true, force: true })
    cpSync(held, ".mutator", { recursive: true })
  }
}

const review = async (): Promise<Review> => {
  const base = load(join(work, "base-report.json"))
  const current = load(".mutator/report/mutation.json")
  const baseRows = rows(join(work, "base-snapshot.json"))
  const currentRows = rows(".mutator/snapshot.json")
  if (base === undefined || current === undefined || baseRows.size === 0 || currentRows.size === 0) {
    return failure("基準と今の結果を読めない", "基準か今のレポート、またはsnapshotがありません。")
  }
  const pending = [reviewTruncation(await mutatorSettings(process.cwd())), reviewPending(baseRows, "基準の全件")]
  const keys = unselectedCandidates(base, current, baseRows, currentRows)
  if (keys.length > 0) {
    process.stdout.write(
      `mutation:diff: running ${keys.length} mutants that the changed tests detected at the base but mutator did not select\n`
    )
  }
  const result = keys.length === 0 ? undefined : rerun(keys)
  const rerunReview =
    result === undefined ? { lines: [], exitCode: 0 } : "exitCode" in result ? result : reviewRerun(base, current, keys, result)
  const reviews = [...pending, rerunReview]
  return { lines: reviews.flatMap((entry) => entry.lines), exitCode: reviews.some((entry) => entry.exitCode !== 0) ? 1 : 0 }
}

const result = await review()
if (result.lines.length > 0) {
  process.stdout.write(`${result.lines.join("\n")}\n`)
}
process.exitCode = result.exitCode
