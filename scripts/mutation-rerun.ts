import { formatAnnotation, placeMutant, type MutantRecord, type MutationReport, type Review } from "./mutation-report.ts"

export interface SnapshotRow {
  readonly scopeHash: string
  readonly status: string
  readonly matrix: boolean
}

const detected: ReadonlySet<string> = new Set(["Killed", "Timeout"])
const undetected: ReadonlySet<string> = new Set(["Survived", "NoCoverage"])

const mutantsById = (report: MutationReport): ReadonlyMap<string, MutantRecord> =>
  new Map([...report.files.values()].flatMap((mutants) => mutants.map((mutant) => [mutant.id, mutant] as const)))

const isRow = (row: unknown): row is ReadonlyArray<unknown> & { readonly 0: string; readonly 3: string; readonly 4: string } =>
  Array.isArray(row) && typeof row[0] === "string" && typeof row[3] === "string" && typeof row[4] === "string"

export const snapshotRows = (snapshot: unknown): ReadonlyMap<string, SnapshotRow> => {
  const rows = typeof snapshot === "object" && snapshot !== null && "rows" in snapshot ? snapshot.rows : undefined
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => isRow(row))
      .map((row) => [row[0], { scopeHash: row[3], status: row[4], matrix: row[9] === 1 }] as const)
  )
}

export type Deps = ReadonlyMap<string, ReadonlyArray<string>>

export const snapshotDeps = (snapshot: unknown): Deps => {
  const deps = typeof snapshot === "object" && snapshot !== null && "deps" in snapshot ? snapshot.deps : undefined
  return new Map(
    typeof deps === "object" && deps !== null
      ? Object.entries(deps).map(
          ([file, list]) => [file, Array.isArray(list) ? list.filter((dep) => typeof dep === "string") : []] as const
        )
      : []
  )
}

const testFileOf = (test: string) => test.slice(0, Math.max(0, test.indexOf("#")))

export const touchedTests = (
  current: MutationReport,
  deps: ReadonlyArray<Deps>,
  helpers: ReadonlyArray<string>
): ((test: string) => boolean) => {
  const tests = new Set(current.touchedTests)
  const changed = new Set(helpers)
  const files = new Set(
    deps.flatMap((graph) => [...graph].filter(([, list]) => list.some((dep) => changed.has(dep))).map(([file]) => file))
  )
  return (test) => tests.has(test) || files.has(testFileOf(test))
}

export const unselectedCandidates = (
  base: MutationReport,
  current: MutationReport,
  baseRows: ReadonlyMap<string, SnapshotRow>,
  currentRows: ReadonlyMap<string, SnapshotRow>,
  touched: (test: string) => boolean
): ReadonlyArray<string> => {
  const reported = new Set(current.findings.filter((finding) => finding.kind === "detectionRegression").map((finding) => finding.key))
  return [...mutantsById(base).values()]
    .filter((mutant) => {
      const before = baseRows.get(mutant.id)
      const now = currentRows.get(mutant.id)
      return (
        mutant.status === "Killed" &&
        mutant.killedBy.some((test) => touched(test)) &&
        before !== undefined &&
        now !== undefined &&
        before.scopeHash === now.scopeHash &&
        !reported.has(mutant.id) &&
        !(detected.has(now.status) && now.matrix)
      )
    })
    .map((mutant) => mutant.id)
    .toSorted()
}

interface Miss {
  readonly key: string
  readonly status: string
  readonly change: string
  readonly killers: string
  readonly place: ReturnType<typeof placeMutant>["place"]
}

const reviewMisses = (
  before: MutationReport,
  placed: MutationReport,
  keys: ReadonlyArray<string>,
  rerun: MutationReport,
  undetectedMessage: (miss: Miss) => string,
  unexpectedMessage: (miss: Miss) => string
): Review => {
  const killedBy = mutantsById(before)
  const after = mutantsById(rerun)
  const lines = keys.flatMap((key) => {
    const status = after.get(key)?.status ?? "結果なし"
    if (detected.has(status)) {
      return []
    }
    const { change, place } = placeMutant(placed, key)
    const killers = (killedBy.get(key)?.killedBy ?? []).map((killer) => `「${killer}」`).join("、") || "テスト"
    const miss = { key, status, change, killers, place }
    return [
      formatAnnotation(
        undetected.has(status)
          ? { level: "error", title: "テストが弱くなった", message: undetectedMessage(miss), ...place }
          : { level: "error", title: "実行し直したミュータントの結果が想定と違う", message: unexpectedMessage(miss), ...place }
      )
    ]
  })
  return { lines, exitCode: lines.length === 0 ? 0 : 1 }
}

export const reviewRerun = (base: MutationReport, current: MutationReport, keys: ReadonlyArray<string>, rerun: MutationReport): Review =>
  reviewMisses(
    base,
    current,
    keys,
    rerun,
    ({ key, change, killers }) =>
      `変わっていないコードのミュータント${key}${change}を、前は${killers}が検出していましたが、今はどのテストも検出しません。mutatorは、変えたテストが確かめるミュータントにこれを選ばなかったので、別に実行して確かめました。mutator acceptで通さないでください。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。`,
    ({ key, change, killers, status }) =>
      `前は${killers}が検出していたミュータント${key}${change}を実行し直すと、${status}になりました。検出したかを確かめられないので失敗にします。`
  )

export const reviewPending = (rows: ReadonlyMap<string, SnapshotRow>, where: string): Review => {
  const pending = [...rows].filter(([, row]) => row.status === "Pending").map(([key]) => key)
  return pending.length === 0
    ? { lines: [], exitCode: 0 }
    : {
        lines: [
          formatAnnotation({
            level: "error",
            title: "実行されなかったミュータントがある",
            message: `${where}で、ミュータント${pending.length}件(${pending.slice(0, 5).join("、")}${pending.length > 5 ? "など" : ""})が実行されずにPendingのまま残りました。mutatorの設定のtimeBudgetやmutantsPerLineなどで実行を打ち切ると、テストが弱くなったかを確かめられないので失敗にします。`
          })
        ],
        exitCode: 1
      }
}

const truncating = ["timeBudget", "mutantsPerLine", "shard"] as const

export const reviewTruncation = (settings: { readonly [key in (typeof truncating)[number]]?: unknown }): Review => {
  const found = truncating.filter((key) => settings[key] !== undefined)
  return found.length === 0
    ? { lines: [], exitCode: 0 }
    : {
        lines: [
          formatAnnotation({
            level: "error",
            title: "ミューテーションテストの実行を打ち切る設定がある",
            message: `mutatorの設定に${found.join("、")}があります。範囲内のミュータントが実行されずにPendingのまま残ると、テストが弱くなったかを確かめられないので失敗にします。設定から外してください。`
          })
        ],
        exitCode: 1
      }
}

export const reviewNotRun = (output: string, where: string): Review => {
  const found = /^not run: .*$/m.exec(output)
  return found === null
    ? { lines: [], exitCode: 0 }
    : {
        lines: [
          formatAnnotation({
            level: "error",
            title: "範囲内のミュータントが実行されなかった",
            message: `${where}で、mutatorが範囲内のミュータントを実行せずに残しました(${found[0]})。テストが弱くなったかを確かめられないので失敗にします。mutatorの設定のtimeBudgetやmutantsPerLineなど、実行を減らす設定を外してください。`
          })
        ],
        exitCode: 1
      }
}

export const vanishCandidates = (listed: MutationReport, base: MutationReport): ReadonlyArray<string> => {
  const now = mutantsById(base)
  return [...mutantsById(listed).keys()].filter((key) => !detected.has(now.get(key)?.status ?? "")).toSorted()
}

export const vanishedKeys = (base: MutationReport, original: MutationReport, touched: (test: string) => boolean): ReadonlyArray<string> => {
  const now = mutantsById(base)
  return [...mutantsById(original).values()]
    .filter(
      (mutant) =>
        mutant.status === "Killed" && mutant.killedBy.some((test) => touched(test)) && !detected.has(now.get(mutant.id)?.status ?? "")
    )
    .map((mutant) => mutant.id)
    .toSorted()
}

export const reviewVanished = (
  base: MutationReport,
  original: MutationReport,
  keys: ReadonlyArray<string>,
  rerun: MutationReport
): Review => {
  const now = mutantsById(base)
  const vanished = ({ key, change, killers }: Miss) => {
    const current = now.get(key)?.status
    return `ミュータント${key}${change}は、分岐点のmutatorの設定では${killers}が検出していましたが、今の設定では${current === undefined ? "作られません" : `${current}になります`}。分岐点の設定で今のテストを実行すると、`
  }
  return reviewMisses(
    original,
    original,
    keys,
    rerun,
    (miss) =>
      `${vanished(miss)}どのテストも検出しません。設定でミュータントを外して、弱めたテストを隠さないでください。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。`,
    (miss) => `${vanished(miss)}${miss.status}になりました。検出したかを確かめられないので失敗にします。`
  )
}
