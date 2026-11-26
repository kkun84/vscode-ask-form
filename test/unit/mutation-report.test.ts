import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "vitest"
import {
  decodeReport,
  formatAnnotation,
  reviewFindings,
  reviewScope,
  reviewSettingChanges,
  type MutationReport
} from "../../scripts/mutation-report.ts"

const regressionAdvice =
  "mutator acceptで通さないでください。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。"

const gapAdvice =
  "どのテストも検出しません。テストが足りないのか、コードが要らないのかを見直してください。テストを足すときは、呼び出す側から見える振る舞いを確かめます。どんな入力でも振る舞いが変わらないミュータントだけをmutator acceptで記録します。手順はnode_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.mdにあります。"

const decode = (value: unknown): MutationReport => {
  const decoded = decodeReport(value)
  if ("problem" in decoded) {
    throw new Error(decoded.problem)
  }
  return decoded.report
}

const fixture = (name: string) => decode(JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")))

const files = {
  "src/core/form.ts": {
    language: "typescript",
    mutants: [
      { id: "other", mutatorName: "BooleanLiteral", replacement: "true", location: { start: { line: 3, column: 1 } } },
      { id: "weak", mutatorName: "EqualityOperator", replacement: "a > b", location: { start: { line: 12, column: 5 } } }
    ]
  }
}

const problem = (value: unknown) => {
  const decoded = decodeReport(value)
  return "problem" in decoded ? decoded.problem : undefined
}

const report = (findings: ReadonlyArray<unknown>, comparison = "available") => decode({ schemaVersion: "2", comparison, findings, files })

test("DES-TOOLS-003 mutator 0.5.0の実際のレポートで、検出できなくなったミュータントを行に付けたエラーにして失敗する", () => {
  assert.deepEqual(reviewFindings(fixture("mutator-0.5.0-regression.json")), {
    lines: [
      `::error file=src/core/expression.ts,line=195,title=テストが弱くなった::変わっていないコードのミュータント1bbzwgwwk8g(ConditionalExpressionでtrueに置き換え)を、前は「test/unit/expression.test.ts#DES-EXPR-002 評価 > DES-EXPR-002 関数を評価する」が検出していましたが、今はどのテストも検出しません。${regressionAdvice}`,
      `::warning file=src/core/expression.ts,line=309,title=テストが検出できないミュータント::ミュータント2fspejx4v1y(ConditionalExpressionでtrueに置き換え)は、${gapAdvice}`,
      "テストが弱くなった箇所: 1件、何も検出しない新しいテスト: 0件、テストが検出できないミュータント: 1件"
    ],
    exitCode: 1
  })
})

test("DES-TOOLS-003 mutator 0.5.0の実際のレポートで、何も検出しない新しいテストを警告にして成功する", () => {
  assert.deepEqual(reviewFindings(fixture("mutator-0.5.0-new-test-no-kills.json")), {
    lines: [
      "::warning file=test/unit/expression.test.ts,title=何も検出しない新しいテスト::test/unit/expression.test.ts#DES-EXPR-002 評価 > DES-EXPR-002 式を評価するだけは、測ったミュータントを1つも検出しません。アサーションを確かめてください。",
      `::warning file=src/core/expression.ts,line=70,title=テストが検出できないミュータント::ミュータント1jkiw3avhr2(Regexで/^(?:\\d\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?/に置き換え)は、${gapAdvice}`,
      "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 1件、テストが検出できないミュータント: 1件"
    ],
    exitCode: 0
  })
})

test("DES-TOOLS-003 mutator 0.5.0の実際のレポートで、比べる基準を使えなかったら失敗する", () => {
  assert.deepEqual(reviewFindings(fixture("mutator-0.5.0-unavailable.json")).exitCode, 1)
})

test("DES-TOOLS-003 検出できなくなったミュータントは、検出できないミュータントとしては重ねて出さない", () => {
  const review = reviewFindings(
    report([
      { kind: "mutationGap", key: "other" },
      { kind: "mutationGap", key: "weak" },
      { kind: "detectionRegression", key: "weak", previousKillers: ["test/unit/form.test.ts#境界", "test/unit/form.test.ts#上限"] }
    ])
  )
  assert.deepEqual(review, {
    lines: [
      `::error file=src/core/form.ts,line=12,title=テストが弱くなった::変わっていないコードのミュータントweak(EqualityOperatorでa > bに置き換え)を、前は「test/unit/form.test.ts#境界」、「test/unit/form.test.ts#上限」が検出していましたが、今はどのテストも検出しません。${regressionAdvice}`,
      `::warning file=src/core/form.ts,line=3,title=テストが検出できないミュータント::ミュータントother(BooleanLiteralでtrueに置き換え)は、${gapAdvice}`,
      "テストが弱くなった箇所: 1件、何も検出しない新しいテスト: 0件、テストが検出できないミュータント: 1件"
    ],
    exitCode: 1
  })
})

test("DES-TOOLS-003 位置の分からないミュータントはファイルを付けずにエラーにする", () => {
  const review = reviewFindings(
    report([
      { kind: "detectionRegression", key: "gone", previousKillers: [] },
      { kind: "detectionRegression", key: "weak", previousKillers: "test" }
    ])
  )
  assert.deepEqual(review.lines.slice(0, 2), [
    `::error title=テストが弱くなった::変わっていないコードのミュータントgoneを、前はテストが検出していましたが、今はどのテストも検出しません。${regressionAdvice}`,
    `::error file=src/core/form.ts,line=12,title=テストが弱くなった::変わっていないコードのミュータントweak(EqualityOperatorでa > bに置き換え)を、前はテストが検出していましたが、今はどのテストも検出しません。${regressionAdvice}`
  ])
  assert.equal(review.exitCode, 1)
})

test("DES-TOOLS-003 知らない種類の指摘は扱わずに成功する", () => {
  assert.deepEqual(reviewFindings(report([{ kind: "testNotMeasured", test: "test/unit/form.test.ts#届かない" }, { key: "no-kind" }])), {
    lines: ["テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件、テストが検出できないミュータント: 0件"],
    exitCode: 0
  })
})

test("DES-TOOLS-003 比べる基準を使えなかったらエラーにして失敗する", () => {
  const review = reviewFindings(report([{ kind: "detectionRegression", key: "weak" }], "unavailable"))
  assert.equal(review.exitCode, 1)
  assert.equal(review.lines.length, 1)
  assert.match(review.lines[0] ?? "", /^::error title=比べる基準を使えなかった::/)
})

test("DES-TOOLS-003 判定に要る項目が欠けたレポートは読まない", () => {
  assert.equal(problem([]), "JSONのオブジェクトではありません。")
  assert.equal(
    problem({ comparison: "available", findings: [], files: {} }),
    "schemaVersionがありません。このスクリプトは2だけを読みます。"
  )
  assert.equal(
    problem({ schemaVersion: 2, comparison: "available", findings: [], files: {} }),
    "schemaVersionが2です。このスクリプトは2だけを読みます。"
  )
  assert.equal(problem({ schemaVersion: "2", findings: [], files: {} }), "comparisonがありません。")
  assert.equal(problem({ schemaVersion: "2", comparison: "yes", findings: [], files: {} }), 'comparisonが"yes"です。')
  assert.equal(problem({ schemaVersion: "2", comparison: "available", files: {} }), "findingsの配列がありません。")
  assert.equal(problem({ schemaVersion: "2", comparison: "available", findings: [] }), "filesのオブジェクトがありません。")
  assert.equal(problem({ schemaVersion: "2", comparison: "unavailable", findings: [], files: {} }), undefined)
})

test("DES-TOOLS-003 注釈の区切りと改行を値の中で符号化する", () => {
  assert.equal(
    formatAnnotation({ level: "warning", title: "a:b,c", message: "100%\r\nok", file: "src/a,b:c.ts", line: 4 }),
    "::warning file=src/a%2Cb%3Ac.ts,line=4,title=a%3Ab%2Cc::100%25%0D%0Aok"
  )
})

test("DES-TOOLS-003 検査の範囲を決める設定が変わったら、どの形式の設定でも警告する", () => {
  assert.deepEqual(
    reviewSettingChanges([
      "src/core/form.ts",
      "mutator.config.ts",
      "mutator.accepted.json",
      "vitest.mutation.config.ts",
      "mutator.config.json"
    ]),
    [
      "::warning file=mutator.accepted.json,title=ミューテーションテストの設定が変わった::mutator.accepted.jsonが変わりました。検査する範囲が狭まっていないか、動作の変わる壊し方を記録していないかを確かめてください。",
      "::warning file=mutator.config.json,title=ミューテーションテストの設定が変わった::mutator.config.jsonが変わりました。検査する範囲が狭まっていないか、動作の変わる壊し方を記録していないかを確かめてください。",
      "::warning file=mutator.config.ts,title=ミューテーションテストの設定が変わった::mutator.config.tsが変わりました。検査する範囲が狭まっていないか、動作の変わる壊し方を記録していないかを確かめてください。",
      "::warning file=vitest.mutation.config.ts,title=ミューテーションテストの設定が変わった::vitest.mutation.config.tsが変わりました。検査する範囲が狭まっていないか、動作の変わる壊し方を記録していないかを確かめてください。"
    ]
  )
  assert.deepEqual(reviewSettingChanges(["src/core/form.ts", "", "docs/mutator.config.json", "docs/lefthook.yml"]), [])
})

test("DES-TOOLS-003 テストの設定と準備のファイル、判定のスクリプトと呼び出し方が変わったら、人が確かめるよう警告する", () => {
  assert.deepEqual(
    reviewSettingChanges(
      [
        "vitest.mutation.config.ts",
        "test/setup.ts",
        "scripts/mutation-diff.sh",
        "scripts/mutation-new.ts",
        "scripts/mutation-new.test.ts",
        "scripts/mutation/nested.ts",
        "src/core/form.ts",
        "package.json",
        "lefthook.yml",
        ".github/workflows/mutation.yml"
      ],
      ["vitest.mutation.config.ts", "test/setup.ts"]
    ),
    [
      "::warning file=vitest.mutation.config.ts,title=テストの設定か準備のファイルが変わった::vitest.mutation.config.tsが変わりました。テストを集める範囲を狭めていないか、アサーションを無力化していないかを、人が確かめてください。ミューテーションテストの判定では見つけられません。",
      "::warning file=test/setup.ts,title=テストの設定か準備のファイルが変わった::test/setup.tsが変わりました。テストを集める範囲を狭めていないか、アサーションを無力化していないかを、人が確かめてください。ミューテーションテストの判定では見つけられません。",
      ...[".github/workflows/mutation.yml", "lefthook.yml", "package.json", "scripts/mutation-diff.sh", "scripts/mutation-new.ts"].map(
        (file) =>
          `::warning file=${file},title=判定のスクリプトか呼び出し方が変わった::${file}が変わりました。テストが弱くなったかの判定を緩めたり、呼ばないようにしたりしていないかを、人が確かめてください。`
      )
    ]
  )
})

const exists = (file: string) => !file.includes("gone")

const scope = (tests: ReadonlyArray<string>, sources: ReadonlyArray<string>) => ({ tests, sources })

test("DES-TOOLS-003 分岐点では集めていたテストファイルが残っているのに集めなくなったら失敗する", () => {
  const review = reviewScope(
    scope(["test/unit/a.test.ts", "test/unit/b.test.ts"], []),
    scope(["test/unit/a.test.ts"], []),
    new Map(),
    () => true
  )
  assert.equal(review.exitCode, 1)
  assert.deepEqual(review.lines, [
    "::error file=test/unit/b.test.ts,title=テストファイルを集めなくなった::test/unit/b.test.tsは、分岐点のVitestの設定では集めていましたが、今の設定では集めません。ファイルは残っているので、テストを外して弱めた変更として失敗にします。Vitestのinclude、exclude、projectsを戻してください。"
  ])
})

test("DES-TOOLS-003 分岐点では対象だったソースファイルが残っているのに対象外になったら失敗する", () => {
  const review = reviewScope(scope([], ["src/core/a.ts", "src/core/b.ts"]), scope([], ["src/core/a.ts"]), new Map(), () => true)
  assert.equal(review.exitCode, 1)
  assert.deepEqual(review.lines, [
    "::error file=src/core/b.ts,title=ミューテーションテストの対象から外れた::src/core/b.tsは、分岐点のmutatorの設定では対象でしたが、今の設定では対象外です。ファイルは残っているので、検査を外して弱めた変更として失敗にします。mutator.config.jsonのinclude、excludeを戻してください。"
  ])
})

test("DES-TOOLS-003 消したファイルと、改名した先を集めているファイルは失敗にしない", () => {
  const base = scope(["test/unit/old.test.ts", "test/unit/gone.test.ts"], ["src/core/old.ts", "src/core/gone.ts"])
  const current = scope(["test/unit/new.test.ts"], ["src/core/new.ts"])
  const renames = new Map([
    ["test/unit/old.test.ts", "test/unit/new.test.ts"],
    ["src/core/old.ts", "src/core/new.ts"]
  ])
  assert.deepEqual(reviewScope(base, current, renames, exists), { lines: [], exitCode: 0 })
  assert.equal(reviewScope(base, scope([], ["src/core/new.ts"]), renames, exists).lines.length, 1)
})
