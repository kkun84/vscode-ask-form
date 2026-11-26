export interface MutantRecord {
  readonly id: string
  readonly mutatorName?: string
  readonly replacement?: string
  readonly line?: number
  readonly status?: string
  readonly statusReason?: string
  readonly killedBy: ReadonlyArray<string>
}

export interface Finding {
  readonly kind: string
  readonly key?: string
  readonly test?: string
  readonly previousKillers: ReadonlyArray<string>
}

export interface MutationReport {
  readonly comparison: "available" | "unavailable"
  readonly findings: ReadonlyArray<Finding>
  readonly files: ReadonlyMap<string, ReadonlyArray<MutantRecord>>
  readonly touchedTests: ReadonlyArray<string>
}

export type DecodedReport = { readonly report: MutationReport } | { readonly problem: string }

export interface Review {
  readonly lines: ReadonlyArray<string>
  readonly exitCode: 0 | 1
}

interface Annotation {
  readonly level: "error" | "warning" | "notice"
  readonly title: string
  readonly message: string
  readonly file?: string
  readonly line?: number
}

type JsonObject = { readonly [field: string]: unknown }

const schemaVersion = "2"

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: JsonObject, field: string): string | undefined => {
  const found = value[field]
  return typeof found === "string" ? found : undefined
}

const optional = <Field extends string, Value>(field: Field, value: Value | undefined): { readonly [key in Field]?: Value } =>
  value === undefined ? {} : ({ [field]: value } as { readonly [key in Field]: Value })

const startLine = (value: unknown): number | undefined => {
  const start = isObject(value) ? value["start"] : undefined
  const line = isObject(start) ? start["line"] : undefined
  return typeof line === "number" ? line : undefined
}

const strings = (value: unknown): ReadonlyArray<string> => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : [])

const changedTests = (value: unknown): ReadonlyArray<string> =>
  isObject(value) ? [...strings(value["changed"]), ...strings(value["removed"])] : []

const selectedTests = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.flatMap((reason) => (isObject(reason) ? strings(reason["tests"]) : [])) : []

const decodeMutant = (value: unknown): ReadonlyArray<MutantRecord> => {
  if (!isObject(value) || typeof value["id"] !== "string") {
    return []
  }
  return [
    {
      id: value["id"],
      ...optional("mutatorName", text(value, "mutatorName")),
      ...optional("replacement", text(value, "replacement")),
      ...optional("line", startLine(value["location"])),
      ...optional("status", text(value, "status")),
      ...optional("statusReason", text(value, "statusReason")),
      killedBy: strings(value["killedBy"])
    }
  ]
}

const decodeFinding = (value: unknown): ReadonlyArray<Finding> => {
  if (!isObject(value) || typeof value["kind"] !== "string") {
    return []
  }
  return [
    {
      kind: value["kind"],
      ...optional("key", text(value, "key")),
      ...optional("test", text(value, "test")),
      previousKillers: strings(value["previousKillers"])
    }
  ]
}

const decodeFiles = (value: JsonObject): ReadonlyMap<string, ReadonlyArray<MutantRecord>> =>
  new Map(
    Object.entries(value).map(([file, entry]) => {
      const mutants = isObject(entry) ? entry["mutants"] : undefined
      return [file, Array.isArray(mutants) ? mutants.flatMap((mutant) => decodeMutant(mutant)) : []]
    })
  )

const describe = (value: unknown) => (value === undefined ? "ありません" : `${JSON.stringify(value)}です`)

export const decodeReport = (value: unknown): DecodedReport => {
  if (!isObject(value)) {
    return { problem: "JSONのオブジェクトではありません。" }
  }
  if (value["schemaVersion"] !== schemaVersion) {
    return { problem: `schemaVersionが${describe(value["schemaVersion"])}。このスクリプトは${schemaVersion}だけを読みます。` }
  }
  const comparison = value["comparison"]
  const findings = value["findings"]
  const files = value["files"]
  if (comparison !== "available" && comparison !== "unavailable") {
    return { problem: `comparisonが${describe(comparison)}。` }
  }
  if (!Array.isArray(findings)) {
    return { problem: "findingsの配列がありません。" }
  }
  if (!isObject(files)) {
    return { problem: "filesのオブジェクトがありません。" }
  }
  return {
    report: {
      comparison,
      findings: findings.flatMap((finding) => decodeFinding(finding)),
      files: decodeFiles(files),
      touchedTests: [...new Set([...changedTests(value["testChanges"]), ...selectedTests(value["selectionReasons"])])]
    }
  }
}

const escapeData = (value: string) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")

const escapeProperty = (value: string) => escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C")

export const formatAnnotation = (annotation: Annotation) => {
  const properties = [
    ...(annotation.file === undefined ? [] : [`file=${escapeProperty(annotation.file)}`]),
    ...(annotation.line === undefined ? [] : [`line=${annotation.line}`]),
    `title=${escapeProperty(annotation.title)}`
  ]
  return `::${annotation.level} ${properties.join(",")}::${escapeData(annotation.message)}`
}

export const failure = (title: string, message: string): Review => ({
  lines: [formatAnnotation({ level: "error", title, message })],
  exitCode: 1
})

export const placeMutant = (report: MutationReport, key: string) => {
  const found = [...report.files]
    .flatMap(([file, mutants]) => mutants.filter((mutant) => mutant.id === key).map((mutant) => ({ file, mutant })))
    .at(0)
  return {
    change: found?.mutant.mutatorName === undefined ? "" : `(${found.mutant.mutatorName}で${found.mutant.replacement ?? ""}に置き換え)`,
    place: { ...optional("file", found?.file), ...optional("line", found?.mutant.line) }
  }
}

const regression = (report: MutationReport, finding: Finding): Annotation => {
  const key = finding.key ?? ""
  const { change, place } = placeMutant(report, key)
  const killers = finding.previousKillers.length === 0 ? "テスト" : finding.previousKillers.map((killer) => `「${killer}」`).join("、")
  return {
    level: "error",
    title: "テストが弱くなった",
    message: `変わっていないコードのミュータント${key}${change}を、前は${killers}が検出していましたが、今はどのテストも検出しません。mutator acceptで通さないでください。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。`,
    ...place
  }
}

const testFile = (test: string) => {
  const at = test.indexOf("#")
  return at <= 0 ? {} : { file: test.slice(0, at) }
}

const noKills = (finding: Finding): Annotation => {
  const test = finding.test ?? ""
  return {
    level: "warning",
    title: "何も検出しない新しいテスト",
    message: `${test}は、測ったミュータントを1つも検出しません。アサーションを確かめてください。`,
    ...testFile(test)
  }
}

const guide = "node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md"

const gap = (report: MutationReport, finding: Finding): Annotation => {
  const key = finding.key ?? ""
  const { change, place } = placeMutant(report, key)
  return {
    level: "warning",
    title: "テストが検出できないミュータント",
    message: `ミュータント${key}${change}は、どのテストも検出しません。テストが足りないのか、コードが要らないのかを見直してください。テストを足すときは、呼び出す側から見える振る舞いを確かめます。どんな入力でも振る舞いが変わらないミュータントだけをmutator acceptで記録します。手順は${guide}にあります。`,
    ...place
  }
}

const unmeasured: Annotation = {
  level: "error",
  title: "比べる基準を使えなかった",
  message:
    "mutatorが比べる基準(変更前のコミットで全件を実行した結果)を使えなかったため、テストが弱くなったかを確かめられません。基準と今とで、Node.jsの版、package.json、ロックファイル、tsconfig.json、pnpm-workspace.yaml、Vitestの設定、mutatorの設定のどれかが違います。基準はpnpm mutation:diff(scripts/mutation-diff.sh)で作ってください。そのうえで起きるなら、scripts/mutation-diff.shが基準へ写すファイルが足りません。"
}

const settings: ReadonlySet<string> = new Set([
  "mutator.config.ts",
  "mutator.config.mts",
  "mutator.config.mjs",
  "mutator.config.js",
  "mutator.config.json",
  "mutator.accepted.json",
  "vitest.mutation.config.ts"
])

const judges: ReadonlySet<string> = new Set(["scripts/vitest-files.ts", "package.json", "lefthook.yml"])

const isJudge = (file: string) =>
  judges.has(file) ||
  file.startsWith(".github/workflows/") ||
  (/^scripts\/mutation-[^/]+$/.test(file) && !/\.(test|spec)\.[^/]+$/.test(file))

const settingWarning = (file: string, testSetup: boolean) =>
  formatAnnotation({
    level: "warning",
    title: testSetup
      ? "テストの設定か準備のファイルが変わった"
      : isJudge(file)
        ? "判定のスクリプトか呼び出し方が変わった"
        : "ミューテーションテストの設定が変わった",
    file,
    message: testSetup
      ? `${file}が変わりました。テストを集める範囲を狭めていないか、アサーションを無力化していないかを、人が確かめてください。ミューテーションテストの判定では見つけられません。`
      : isJudge(file)
        ? `${file}が変わりました。テストが弱くなったかの判定を緩めたり、呼ばないようにしたりしていないかを、人が確かめてください。`
        : `${file}が変わりました。検査する範囲が狭まっていないか、動作の変わる壊し方を記録していないかを確かめてください。`
  })

export const reviewSettingChanges = (
  changedFiles: ReadonlyArray<string>,
  testSetupFiles: ReadonlyArray<string> = []
): ReadonlyArray<string> => [
  ...testSetupFiles.filter((file) => changedFiles.includes(file)).map((file) => settingWarning(file, true)),
  ...changedFiles
    .filter((file) => (settings.has(file) || isJudge(file)) && !testSetupFiles.includes(file))
    .toSorted()
    .map((file) => settingWarning(file, false))
]

export interface Scope {
  readonly tests: ReadonlyArray<string>
  readonly sources: ReadonlyArray<string>
}

const dropped = (
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
  renames: ReadonlyMap<string, string>,
  exists: (file: string) => boolean
) => before.map((file) => renames.get(file) ?? file).filter((file) => !after.includes(file) && exists(file))

export const reviewScope = (
  base: Scope,
  current: Scope,
  renames: ReadonlyMap<string, string>,
  exists: (file: string) => boolean
): Review => {
  const tests = dropped(base.tests, current.tests, renames, exists).map((file) =>
    formatAnnotation({
      level: "error",
      title: "テストファイルを集めなくなった",
      file,
      message: `${file}は、分岐点のVitestの設定では集めていましたが、今の設定では集めません。ファイルは残っているので、テストを外して弱めた変更として失敗にします。Vitestのinclude、exclude、projectsを戻してください。`
    })
  )
  const sources = dropped(base.sources, current.sources, renames, exists).map((file) =>
    formatAnnotation({
      level: "error",
      title: "ミューテーションテストの対象から外れた",
      file,
      message: `${file}は、分岐点のmutatorの設定では対象でしたが、今の設定では対象外です。ファイルは残っているので、検査を外して弱めた変更として失敗にします。mutator.config.jsonのinclude、excludeを戻してください。`
    })
  )
  return { lines: [...tests, ...sources], exitCode: tests.length + sources.length === 0 ? 0 : 1 }
}

export const reviewFindings = (report: MutationReport): Review => {
  if (report.comparison === "unavailable") {
    return { lines: [formatAnnotation(unmeasured)], exitCode: 1 }
  }
  const regressed = report.findings.filter((finding) => finding.kind === "detectionRegression")
  const regressedKeys = new Set(regressed.map((finding) => finding.key))
  const regressions = regressed.map((finding) => regression(report, finding))
  const idle = report.findings.filter((finding) => finding.kind === "newTestNoKills").map((finding) => noKills(finding))
  const gaps = report.findings
    .filter((finding) => finding.kind === "mutationGap" && !regressedKeys.has(finding.key))
    .map((finding) => gap(report, finding))
  return {
    lines: [
      ...[...regressions, ...idle, ...gaps].map((annotation) => formatAnnotation(annotation)),
      `テストが弱くなった箇所: ${regressions.length}件、何も検出しない新しいテスト: ${idle.length}件、テストが検出できないミュータント: ${gaps.length}件`
    ],
    exitCode: regressions.length === 0 ? 0 : 1
  }
}
