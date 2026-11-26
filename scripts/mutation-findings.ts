import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import {
  decodeReport,
  failure,
  reviewFindings,
  reviewScope,
  reviewSettingChanges,
  summarize,
  type Review,
  type Scope
} from "./mutation-report.ts"

const path = ".mutator/report/mutation.json"

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

const read = (): Review | string => {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT"
      ? failure("ミューテーションテストの結果が無い", `${path}がありません。先にpnpm mutation:diffを実行してください。`)
      : failure("ミューテーションテストの結果を読めない", `${path}を読めません: ${reason(error)}`)
  }
}

const review = (): Review => {
  const content = read()
  if (typeof content !== "string") {
    return content
  }
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    return failure("ミューテーションテストの結果を読めない", `${path}がJSONとして読めません: ${reason(error)}`)
  }
  const decoded = decodeReport(value)
  return "problem" in decoded
    ? failure("ミューテーションテストの結果の形が違う", `${path}は想定したmutatorのレポートではありません: ${decoded.problem}`)
    : reviewFindings(decoded.report)
}

const git = (args: ReadonlyArray<string>) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

const changed = (base: string): ReadonlyArray<string> | Review => {
  try {
    const mergeBase = git(["merge-base", base, "HEAD"]).trim()
    return [
      ...new Set(
        [
          ...git(["diff", "--no-renames", "--name-only", mergeBase]).split("\n"),
          ...git(["ls-files", "--others", "--exclude-standard"]).split("\n")
        ].filter((file) => file !== "")
      )
    ]
  } catch (error) {
    return failure(
      "基準のrefと比べられない",
      `${base}との共通の祖先からの差分を取れません。refの名前と、履歴を取得しているか(CIではfetch-depth: 0)を確かめてください: ${reason(error)}`
    )
  }
}

const renames = (base: string): ReadonlyMap<string, string> =>
  new Map(
    git(["diff", "-M", "--name-status", base])
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((fields) => fields[0]?.startsWith("R") === true && fields.length === 3)
      .map((fields) => [fields[1] ?? "", fields[2] ?? ""])
  )

const load = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Scope

const scopeReview = (base: string | undefined, baseScope: string | undefined, currentScope: string | undefined): Review => {
  if (baseScope === undefined || currentScope === undefined) {
    return { lines: [], exitCode: 0 }
  }
  if (base === undefined) {
    return failure("基準のrefが無い", "--base-scopeと--scopeには、比べる基準のrefも渡してください。")
  }
  try {
    return reviewScope(load(baseScope), load(currentScope), renames(base), (file) => existsSync(file))
  } catch (error) {
    return failure("テストと対象の一覧を比べられない", reason(error))
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "base-scope": { type: "string" },
    scope: { type: "string" },
    "test-setup": { type: "string", multiple: true, default: [] }
  }
})
const base = positionals[0]
const files = base === undefined ? [] : changed(base)
const scope = scopeReview(base, values["base-scope"], values.scope)
const result = "exitCode" in files ? files : review()
const warnings = "exitCode" in files ? [] : reviewSettingChanges(files, values["test-setup"])
const lines = [...warnings, ...scope.lines, ...result.lines]
const exitCode = Math.max(scope.exitCode, result.exitCode)
const summary = base === undefined ? summarize(lines.join("\n"), exitCode !== 0).lines : []
process.stdout.write(`${[...lines, ...summary].join("\n")}\n`)
process.exitCode = exitCode
