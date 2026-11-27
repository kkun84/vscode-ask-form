import { execFileSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { dirname, join } from "node:path"
import { decodeReport, failure, type MutationReport, type Review } from "./mutation-report.ts"
import {
  reviewNotRun,
  reviewPending,
  reviewRerun,
  reviewVanished,
  snapshotDeps,
  snapshotRows,
  touchedTests,
  unselectedCandidates,
  vanishedKeys
} from "./mutation-rerun.ts"
import { emit, runMutator } from "./mutation-run.ts"

const [work = "", mergeBase = ""] = process.argv.slice(2)
const tree = join(work, "tree")

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

const gitFiles = (args: ReadonlyArray<string>) =>
  execFileSync("git", [...args, "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .split("\0")
    .filter((file) => file !== "")

const helpers = (): ReadonlyArray<string> => {
  const existed = new Set(gitFiles(["ls-tree", "-r", "--name-only", mergeBase]))
  const mutated = new Set([
    ...sources(join(work, "base-scope.json")),
    ...sources(join(work, "scope.json")).filter((file) => !existed.has(file))
  ])
  return [...git(["diff", "--no-renames", "--name-only", mergeBase]), ...git(["ls-files", "--others", "--exclude-standard"])].filter(
    (file) => !mutated.has(file)
  )
}

const copyInto = (file: string, target: string) => {
  const stat = lstatSync(file)
  mkdirSync(dirname(target), { recursive: true })
  rmSync(target, { recursive: true, force: true })
  if (stat.isSymbolicLink()) {
    symlinkSync(readlinkSync(file), target)
  } else if (stat.isFile()) {
    copyFileSync(file, target)
  }
}

const prepareTree = () => {
  const current = gitFiles(["ls-files", "--cached", "--others", "--exclude-standard"]).filter((file) => {
    try {
      lstatSync(file)
      return true
    } catch {
      return false
    }
  })
  const kept = new Set(current)
  for (const file of gitFiles(["-C", tree, "ls-files"])) {
    if (!kept.has(file)) {
      rmSync(join(tree, file), { force: true })
    }
  }
  for (const file of current) {
    copyInto(file, join(tree, file))
  }
  for (const file of readFileSync(join(work, "env-files"), "utf8")
    .split("\n")
    .filter((name) => name !== "")) {
    rmSync(join(tree, file), { force: true })
    let original: string | undefined
    try {
      original = execFileSync("git", ["show", `${mergeBase}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    } catch {
      original = undefined
    }
    if (original !== undefined) {
      mkdirSync(dirname(join(tree, file)), { recursive: true })
      writeFileSync(join(tree, file), original)
    }
  }
  rmSync(join(tree, ".mutator"), { recursive: true, force: true })
}

const rerun = (keys: ReadonlyArray<string>, name: string): MutationReport | Review => {
  const held = join(work, "held-mutator")
  rmSync(held, { recursive: true, force: true })
  cpSync(".mutator", held, { recursive: true })
  try {
    rmSync(".mutator", { recursive: true, force: true })
    const ran = runMutator([...keys.flatMap((key) => ["--only", key]), "--kill-matrix"], join(work, name))
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

const vanished = (base: MutationReport, touched: (test: string) => boolean): Review => {
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
    `mutation:diff: running ${keys.length} mutants with the base's mutator settings and environment files that the changed tests detected there but the current settings drop\n`
  )
  prepareTree()
  const ran = runMutator([...keys.flatMap((key) => ["--only", key]), "--kill-matrix"], join(work, "original-rerun"), tree)
  if ("problem" in ran) {
    return failure("実行し直せない", `ミュータント${keys.join("、")}を分岐点の設定で実行し直せませんでした: ${ran.problem}`)
  }
  const notRun = reviewNotRun(ran.stdout, "分岐点の設定での実行し直し")
  return notRun.exitCode === 0 ? reviewVanished(base, original, keys, ran.report) : notRun
}

const review = (): Review => {
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
  const checks = [reviewPending(baseRows, "基準の全件"), vanished(base, touched)]
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

const guarded = (): Review => {
  try {
    return review()
  } catch (error) {
    if (error instanceof Unreadable) {
      return failure("基準と今の結果を読めない", error.message)
    }
    return failure("実行し直しの判定が失敗した", reason(error))
  }
}

emit(guarded())
