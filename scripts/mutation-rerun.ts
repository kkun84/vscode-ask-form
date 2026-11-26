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

export const unselectedCandidates = (
  base: MutationReport,
  current: MutationReport,
  baseRows: ReadonlyMap<string, SnapshotRow>,
  currentRows: ReadonlyMap<string, SnapshotRow>
): ReadonlyArray<string> => {
  const touched = new Set(current.touchedTests)
  const reported = new Set(current.findings.filter((finding) => finding.kind === "detectionRegression").map((finding) => finding.key))
  return [...mutantsById(base).values()]
    .filter((mutant) => {
      const before = baseRows.get(mutant.id)
      const now = currentRows.get(mutant.id)
      return (
        mutant.status === "Killed" &&
        mutant.killedBy.some((test) => touched.has(test)) &&
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

export const reviewRerun = (base: MutationReport, current: MutationReport, keys: ReadonlyArray<string>, rerun: MutationReport): Review => {
  const before = mutantsById(base)
  const after = mutantsById(rerun)
  const lines = keys.flatMap((key) => {
    const status = after.get(key)?.status ?? "結果なし"
    if (detected.has(status)) {
      return []
    }
    const { change, place } = placeMutant(current, key)
    const killers = (before.get(key)?.killedBy ?? []).map((killer) => `「${killer}」`).join("、") || "テスト"
    return [
      formatAnnotation(
        undetected.has(status)
          ? {
              level: "error",
              title: "テストが弱くなった",
              message: `変わっていないコードのミュータント${key}${change}を、前は${killers}が検出していましたが、今はどのテストも検出しません。mutatorは、変えたテストが確かめるミュータントにこれを選ばなかったので、別に実行して確かめました。mutator acceptで通さないでください。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。`,
              ...place
            }
          : {
              level: "error",
              title: "実行し直したミュータントの結果が想定と違う",
              message: `前は${killers}が検出していたミュータント${key}${change}を実行し直すと、${status}になりました。検出したかを確かめられないので失敗にします。`,
              ...place
            }
      )
    ]
  })
  return { lines, exitCode: lines.length === 0 ? 0 : 1 }
}

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
