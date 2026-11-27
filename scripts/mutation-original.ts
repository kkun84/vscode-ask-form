import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { decodeReport, failure, type Review } from "./mutation-report.ts"
import { vanishCandidates } from "./mutation-rerun.ts"
import { emit, runMutator } from "./mutation-run.ts"
import { mutatorSettings } from "./mutation-vitest.ts"

const [root = "", work = "", ...changedEnvironment] = process.argv.slice(2)
const tree = process.cwd()
const title = "分岐点の設定でミュータントを数えられない"

const review = async (): Promise<Review> => {
  if (changedEnvironment.length === 0 && isDeepStrictEqual(await mutatorSettings(tree), await mutatorSettings(root))) {
    return { lines: [], exitCode: 0 }
  }
  const path = join(work, "base-report.json")
  let base
  try {
    base = decodeReport(JSON.parse(readFileSync(path, "utf8")))
  } catch (error) {
    return failure("基準の結果を読めない", `${path}を読めません: ${error instanceof Error ? error.message : String(error)}`)
  }
  if ("problem" in base) {
    return failure("基準の結果を読めない", `${path}は想定したmutatorのレポートではありません: ${base.problem}`)
  }
  const listed = runMutator(["--time-budget", "0"], join(work, "original-list"), tree)
  if ("problem" in listed) {
    return failure(title, listed.problem)
  }
  const keys = vanishCandidates(listed.report, base.report)
  process.stdout.write(
    `mutation:diff: ${changedEnvironment.length === 0 ? "the mutator settings" : `the mutator settings or environment files (${changedEnvironment.join(", ")})`} changed; running ${keys.length} mutants with the base's settings that the current settings do not detect at the base\n`
  )
  if (keys.length === 0) {
    return { lines: [], exitCode: 0 }
  }
  const original = runMutator(
    keys.flatMap((key) => ["--only", key]),
    join(work, "original"),
    tree
  )
  return "problem" in original ? failure(title, original.problem) : { lines: [], exitCode: 0 }
}

emit(await review())
