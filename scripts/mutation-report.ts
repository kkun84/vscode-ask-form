export interface MutantRecord {
  readonly id: string
  readonly mutatorName?: string
  readonly replacement?: string
  readonly location?: { readonly start?: { readonly line?: number } }
}

export interface Finding {
  readonly kind: string
  readonly key?: string
  readonly test?: string
  readonly previousKillers?: ReadonlyArray<string>
}

export interface MutationReport {
  readonly comparison?: string
  readonly findings?: ReadonlyArray<Finding>
  readonly files?: Readonly<Record<string, { readonly mutants?: ReadonlyArray<MutantRecord> }>>
}

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

const escapeData = (text: string) => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")

const escapeProperty = (text: string) => escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C")

export const formatAnnotation = (annotation: Annotation) => {
  const properties = [
    ...(annotation.file === undefined ? [] : [`file=${escapeProperty(annotation.file)}`]),
    ...(annotation.line === undefined ? [] : [`line=${annotation.line}`]),
    `title=${escapeProperty(annotation.title)}`
  ]
  return `::${annotation.level} ${properties.join(",")}::${escapeData(annotation.message)}`
}

const locate = (report: MutationReport, key: string) =>
  Object.entries(report.files ?? {})
    .flatMap(([file, entry]) => (entry.mutants ?? []).filter((mutant) => mutant.id === key).map((mutant) => ({ file, mutant })))
    .at(0)

const regression = (report: MutationReport, finding: Finding): Annotation => {
  const key = finding.key ?? ""
  const found = locate(report, key)
  const killers = finding.previousKillers ?? []
  const change = found?.mutant.mutatorName === undefined ? "" : `(${found.mutant.mutatorName}で${found.mutant.replacement ?? ""}に置き換え)`
  const message = `変わっていないコードのミュータント${key}${change}を、前は${killers.length === 0 ? "テスト" : killers.map((killer) => `「${killer}」`).join("、")}が検出していましたが、今はどのテストも検出しません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。`
  const line = found?.mutant.location?.start?.line
  return {
    level: "error",
    title: "テストが弱くなった",
    message,
    ...(found === undefined ? {} : { file: found.file }),
    ...(found === undefined || line === undefined ? {} : { line })
  }
}

const noKills = (finding: Finding): Annotation => ({
  level: "warning",
  title: "何も検出しない新しいテスト",
  message: finding.test ?? ""
})

const guide = "node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md"

export const reviewFindings = (report: MutationReport | undefined, path: string): Review => {
  if (report === undefined) {
    return {
      lines: [
        formatAnnotation({
          level: "error",
          title: "ミューテーションテストの結果が無い",
          message: `${path}がありません。先にmutatorを--reporter jsonを付けて実行してください。`
        })
      ],
      exitCode: 1
    }
  }
  const findings = report.findings ?? []
  const regressions = findings.filter((finding) => finding.kind === "detectionRegression").map((finding) => regression(report, finding))
  const idle = findings.filter((finding) => finding.kind === "newTestNoKills").map((finding) => noKills(finding))
  const gaps = findings.filter((finding) => finding.kind === "mutationGap").length
  const unmeasured: ReadonlyArray<Annotation> =
    report.comparison === "unavailable"
      ? [
          {
            level: "notice",
            title: "比較の基準が無い",
            message:
              "前回の結果が無いか、package.json、ロックファイル、tsconfig.json、Node.jsの版、mutatorの設定のどれかが変わったため、テストが弱くなったかは確かめていません。"
          }
        ]
      : []
  return {
    lines: [
      ...[...unmeasured, ...regressions, ...idle].map((annotation) => formatAnnotation(annotation)),
      `テストが弱くなった箇所: ${regressions.length}件、何も検出しない新しいテスト: ${idle.length}件`,
      ...(gaps === 0
        ? []
        : [
            `テストが検出できなかったミュータント: ${gaps}件。テストが足りないのか、コードが要らないのかを見直してください。テストを足すときは、呼び出す側から見える振る舞いを確かめます。手順は${guide}にあります。`
          ])
    ],
    exitCode: regressions.length === 0 ? 0 : 1
  }
}
