import assert from "node:assert/strict"
import { test } from "vitest"
import { formatAnnotation, reviewFindings } from "../../scripts/mutation-report.ts"

const files = {
  "src/core/form.ts": {
    mutants: [
      { id: "other", mutatorName: "BooleanLiteral", replacement: "true", location: { start: { line: 3 } } },
      { id: "weak", mutatorName: "EqualityOperator", replacement: "a > b", location: { start: { line: 12 } } }
    ]
  }
}

test("DES-TOOLS-003 検出できなくなったミュータントを行に付けたエラーにして失敗する", () => {
  const review = reviewFindings(
    {
      findings: [
        { kind: "mutationGap", key: "other" },
        { kind: "detectionRegression", key: "weak", previousKillers: ["test/unit/form.test.ts#境界", "test/unit/form.test.ts#上限"] }
      ],
      files
    },
    "mutation.json"
  )
  assert.deepEqual(review, {
    lines: [
      "::error file=src/core/form.ts,line=12,title=テストが弱くなった::変わっていないコードのミュータントweak(EqualityOperatorでa > bに置き換え)を、前は「test/unit/form.test.ts#境界」、「test/unit/form.test.ts#上限」が検出していましたが、今はどのテストも検出しません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。",
      "テストが弱くなった箇所: 1件、何も検出しない新しいテスト: 0件"
    ],
    exitCode: 1
  })
})

test("DES-TOOLS-003 位置の分からないミュータントはファイルを付けずにエラーにする", () => {
  const review = reviewFindings(
    {
      findings: [
        { kind: "detectionRegression", key: "gone", previousKillers: [] },
        { kind: "detectionRegression", key: "weak" }
      ],
      files: { "src/core/form.ts": { mutants: [{ id: "weak" }] } }
    },
    "mutation.json"
  )
  assert.deepEqual(review.lines.slice(0, 2), [
    "::error title=テストが弱くなった::変わっていないコードのミュータントgoneを、前はテストが検出していましたが、今はどのテストも検出しません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。",
    "::error file=src/core/form.ts,title=テストが弱くなった::変わっていないコードのミュータントweakを、前はテストが検出していましたが、今はどのテストも検出しません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。"
  ])
  assert.equal(review.exitCode, 1)
})

test("DES-TOOLS-003 何も検出しない新しいテストは警告だけにして成功する", () => {
  assert.deepEqual(
    reviewFindings(
      {
        findings: [
          { kind: "newTestNoKills", test: "test/unit/form.test.ts#呼ぶだけ" },
          { kind: "testNotMeasured", test: "test/unit/form.test.ts#届かない" }
        ],
        files
      },
      "mutation.json"
    ),
    {
      lines: [
        "::warning title=何も検出しない新しいテスト::test/unit/form.test.ts#呼ぶだけ",
        "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 1件"
      ],
      exitCode: 0
    }
  )
  assert.deepEqual(reviewFindings({}, "mutation.json"), {
    lines: ["テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件"],
    exitCode: 0
  })
})

test("DES-TOOLS-003 結果のファイルが無ければエラーにして失敗する", () => {
  assert.deepEqual(reviewFindings(undefined, ".mutator/report/mutation.json"), {
    lines: [
      "::error title=ミューテーションテストの結果が無い::.mutator/report/mutation.jsonがありません。先にmutatorを--reporter jsonを付けて実行してください。"
    ],
    exitCode: 1
  })
})

test("DES-TOOLS-003 注釈の区切りと改行を値の中で符号化する", () => {
  assert.equal(
    formatAnnotation({ level: "warning", title: "a:b,c", message: "100%\r\nok", file: "src/a,b:c.ts", line: 4 }),
    "::warning file=src/a%2Cb%3Ac.ts,line=4,title=a%3Ab%2Cc::100%25%0D%0Aok"
  )
})

test("DES-TOOLS-003 前回の結果と比べられなかったことを失敗にせず知らせる", () => {
  assert.deepEqual(reviewFindings({ comparison: "unavailable", findings: [] }, "mutation.json"), {
    lines: [
      "::notice title=比較の基準が無い::前回の結果が無いか、package.json、ロックファイル、tsconfig.json、Node.jsの版、mutatorの設定のどれかが変わったため、テストが弱くなったかは確かめていません。",
      "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件"
    ],
    exitCode: 0
  })
  assert.equal(reviewFindings({ comparison: "available", findings: [] }, "mutation.json").lines.length, 1)
})
