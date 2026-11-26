import { loadConfig } from "@mizchi/mutator"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { decodeReport, failure, type MutationReport, type Review } from "./mutation-report.ts"
import {
  reviewNotRun,
  reviewPending,
  reviewRerun,
  reviewTruncation,
  reviewVanished,
  snapshotDeps,
  snapshotRows,
  touchedTests,
  unselectedCandidates,
  vanishedKeys
} from "./mutation-rerun.ts"
import { emit, runMutator } from "./mutation-run.ts"
import { mutatorSettings } from "./mutation-vitest.ts"

const [work = "", mergeBase = ""] = process.argv.slice(2)

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

class Unreadable extends Error {}

const json = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Unreadable(`${path}を読めません: ${reason(error)}`)
  }
}

const load = (path: string): MutationReport => {
  const decoded = decodeReport(json(path))
  if ("problem" in decoded) {
    throw new Unreadable(`${path}は想定したmutatorのレポートではありません: ${decoded.problem}`)
  }
  return decoded.report
}

const sources = (path: string): ReadonlyArray<string> => {
  const scope = json(path)
  const list = typeof scope === "object" && scope !== null && "sources" in scope ? scope.sources : undefined
  if (!Array.isArray(list)) {
    throw new Unreadable(`${path}にsourcesの配列がありません。`)
  }
  return list.filter((file) => typeof file === "string")
}

const git = (args: ReadonlyArray<string>) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .split("\n")
    .filter((file) => file !== "")

const helpers = (): ReadonlyArray<string> => {
  const mutated = new Set([...sources(join(work, "scope.json")), ...sources(join(work, "base-scope.json"))])
  return [...git(["diff", "--no-renames", "--name-only", mergeBase]), ...git(["ls-files", "--others", "--exclude-standard"])].filter(
    (file) => !mutated.has(file)
  )
}

const rerun = (keys: ReadonlyArray<string>, name: string, settings: ReadonlyArray<string> = []): MutationReport | Review => {
  const held = join(work, "held-mutator")
  rmSync(held, { recursive: true, force: true })
  cpSync(".mutator", held, { recursive: true })
  try {
    rmSync(".mutator", { recursive: true, force: true })
    const ran = runMutator([...settings, ...keys.flatMap((key) => ["--only", key]), "--kill-matrix"], join(work, name))
    if ("problem" in ran) {
      return failure("実行し直せない", `ミュータント${keys.join("、")}を実行し直せませんでした: ${ran.problem}`)
    }
    const notRun = reviewNotRun(ran.stdout, "実行し直し")
    return notRun.exitCode === 0 ? ran.report : notRun
  } finally {
    rmSync(".mutator", { recursive: true, force: true })
    cpSync(held, ".mutator", { recursive: true })
  }
}

const vanished = async (base: MutationReport, touched: (test: string) => boolean): Promise<Review> => {
  const path = join(work, "original", "mutation.json")
  if (!existsSync(path)) {
    return { lines: [], exitCode: 0 }
  }
  const original = load(path)
  const keys = vanishedKeys(base, original, touched)
  if (keys.length === 0) {
    return { lines: [], exitCode: 0 }
  }
  process.stdout.write(
    `mutation:diff: running ${keys.length} mutants with the base's mutator settings that the changed tests detected there but the current settings drop\n`
  )
  const empty = join(work, "mutator.config.json")
  writeFileSync(empty, "{}\n")
  const settings = (await loadConfig(join(work, "tree")))?.path ?? empty
  const result = rerun(keys, "original-rerun", ["--config-file", settings])
  return "exitCode" in result ? result : reviewVanished(base, original, keys, result)
}

const review = async (): Promise<Review> => {
  const base = load(join(work, "base-report.json"))
  const current = load(".mutator/report/mutation.json")
  const baseSnapshot = json(join(work, "base-snapshot.json"))
  const currentSnapshot = json(".mutator/snapshot.json")
  const baseRows = snapshotRows(baseSnapshot)
  const currentRows = snapshotRows(currentSnapshot)
  if (baseRows.size === 0 || currentRows.size === 0) {
    return failure("基準と今の結果を読めない", "基準か今のsnapshotに、ミュータントの行がありません。")
  }
  const touched = touchedTests(current, [snapshotDeps(baseSnapshot), snapshotDeps(currentSnapshot)], helpers())
  const checks = [
    reviewTruncation(await mutatorSettings(process.cwd())),
    reviewPending(baseRows, "基準の全件"),
    await vanished(base, touched)
  ]
  const keys = unselectedCandidates(base, current, baseRows, currentRows, touched)
  if (keys.length > 0) {
    process.stdout.write(
      `mutation:diff: running ${keys.length} mutants that the changed tests detected at the base but mutator did not select\n`
    )
  }
  const result = keys.length === 0 ? undefined : rerun(keys, "rerun")
  const rerunReview =
    result === undefined ? { lines: [], exitCode: 0 } : "exitCode" in result ? result : reviewRerun(base, current, keys, result)
  const reviews = [...checks, rerunReview]
  return { lines: reviews.flatMap((entry) => entry.lines), exitCode: reviews.some((entry) => entry.exitCode !== 0) ? 1 : 0 }
}

const guarded = async (): Promise<Review> => {
  try {
    return await review()
  } catch (error) {
    if (error instanceof Unreadable) {
      return failure("基準と今の結果を読めない", error.message)
    }
    return failure("実行し直しの判定が失敗した", reason(error))
  }
}

emit(await guarded())
