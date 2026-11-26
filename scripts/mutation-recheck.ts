import { spawnSync } from "node:child_process"
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  decodeReport,
  failure,
  recheckCandidates,
  reviewRechecked,
  scopeHashes,
  type MutationReport,
  type Review
} from "./mutation-report.ts"

const rechecks = 2
const [work = ""] = process.argv.slice(2)

const load = (path: string): MutationReport | undefined => {
  if (!existsSync(path)) {
    return undefined
  }
  const decoded = decodeReport(JSON.parse(readFileSync(path, "utf8")))
  return "report" in decoded ? decoded.report : undefined
}

const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))

const recheck = (): Review => {
  const base = load(join(work, "base-report.json"))
  const current = load(".mutator/report/mutation.json")
  if (
    base === undefined ||
    current === undefined ||
    !existsSync(join(work, "base-snapshot.json")) ||
    !existsSync(".mutator/snapshot.json")
  ) {
    return failure("実行し直す相手を決められない", "基準か今のレポート、またはsnapshotがありません。")
  }
  const keys = recheckCandidates(
    base,
    current,
    scopeHashes(json(join(work, "base-snapshot.json"))),
    scopeHashes(json(".mutator/snapshot.json"))
  )
  if (keys.length === 0) {
    return { lines: [], exitCode: 0 }
  }
  process.stdout.write(
    `mutation:diff: re-running ${keys.length} mutants detected only through reused results, ${rechecks} times without them\n`
  )
  const held = join(work, "held-mutator")
  cpSync(".mutator", held, { recursive: true })
  const reruns: Array<MutationReport> = []
  try {
    for (let attempt = 1; attempt <= rechecks; attempt++) {
      rmSync(".mutator", { recursive: true, force: true })
      const directory = join(work, `recheck-${attempt}`)
      const result = spawnSync(
        "pnpm",
        ["exec", "mutator", ...keys.flatMap((key) => ["--only", key]), "--reporter", "json", "--report-dir", directory],
        { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } }
      )
      const report = load(join(directory, "mutation.json"))
      if (result.status !== 0 || report === undefined) {
        process.stderr.write(`${result.stdout}\n${result.stderr}\n`)
        return failure("実行し直せない", `前の結果を使わずにミュータント${keys.join("、")}を実行し直せませんでした。`)
      }
      reruns.push(report)
    }
  } finally {
    rmSync(".mutator", { recursive: true, force: true })
    cpSync(held, ".mutator", { recursive: true })
  }
  return reviewRechecked(base, current, keys, reruns)
}

const review = recheck()
if (review.lines.length > 0) {
  process.stdout.write(`${review.lines.join("\n")}\n`)
}
process.exitCode = review.exitCode
