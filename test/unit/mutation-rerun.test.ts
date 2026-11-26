import assert from "node:assert/strict"
import { test } from "vitest"
import { decodeReport, type MutationReport } from "../../scripts/mutation-report.ts"
import {
  reviewPending,
  reviewRerun,
  reviewTruncation,
  snapshotRows,
  unselectedCandidates,
  type SnapshotRow
} from "../../scripts/mutation-rerun.ts"

const report = (
  mutants: ReadonlyArray<unknown>,
  changed: ReadonlyArray<string> = [],
  findings: ReadonlyArray<unknown> = []
): MutationReport => {
  const decoded = decodeReport({
    schemaVersion: "2",
    comparison: "available",
    findings,
    testChanges: { added: [], changed, removed: [] },
    files: { "src/core/spec.ts": { language: "typescript", mutants } }
  })
  if ("problem" in decoded) {
    throw new Error(decoded.problem)
  }
  return decoded.report
}

const mutant = (id: string, status: string, killedBy: ReadonlyArray<string> = []) => ({
  id,
  mutatorName: "Regex",
  replacement: "/a/",
  location: { start: { line: 6, column: 1 } },
  status,
  killedBy,
  coveredBy: []
})

const weakened = "test/unit/form-edge-cases.test.ts#予約語"
const other = "test/unit/form.test.ts#読み取り"

const row = (status: string, matrix = false, scopeHash = "s"): SnapshotRow => ({ scopeHash, status, matrix })

test("DES-TOOLS-003 変えたテストが基準で検出し、今回は実行されていないミュータントを、別に実行する相手に選ぶ", () => {
  const ids = ["pending", "reused", "fresh", "fresh-timeout", "other-killer", "scope-changed", "reported", "survived-before"]
  const base = report([
    ...ids.filter((id) => id !== "other-killer" && id !== "survived-before").map((id) => mutant(id, "Killed", [weakened])),
    mutant("other-killer", "Killed", [other]),
    mutant("survived-before", "Survived")
  ])
  const current = report([], [weakened], [{ kind: "detectionRegression", key: "reported", previousKillers: [weakened] }])
  const baseRows = new Map(ids.map((id) => [id, row("Killed")]))
  const currentRows = new Map([
    ["pending", row("Pending")],
    ["reused", row("Killed")],
    ["fresh", row("Killed", true)],
    ["fresh-timeout", row("Timeout", true)],
    ["other-killer", row("Killed")],
    ["scope-changed", row("Killed", false, "t")],
    ["reported", row("Survived", true)],
    ["survived-before", row("Survived")]
  ])
  assert.deepEqual(unselectedCandidates(base, current, baseRows, currentRows), ["pending", "reused"])
})

test("DES-TOOLS-003 別に実行したミュータントが検出されなければテストが弱くなったとし、想定外の状態も失敗にする", () => {
  const base = report([
    mutant("a", "Killed", [weakened]),
    mutant("b", "Killed", [weakened]),
    mutant("c", "Killed", [weakened]),
    mutant("d", "Killed", [weakened])
  ])
  const current = report([mutant("a", "Pending"), mutant("b", "Pending"), mutant("c", "Pending"), mutant("d", "Pending")], [weakened])
  const rerun = report([mutant("a", "Killed", [other]), mutant("b", "Survived"), mutant("c", "RuntimeError"), mutant("d", "Timeout")])
  const review = reviewRerun(base, current, ["a", "b", "c", "d", "e"], rerun)
  assert.equal(review.exitCode, 1)
  assert.deepEqual(review.lines, [
    `::error file=src/core/spec.ts,line=6,title=テストが弱くなった::変わっていないコードのミュータントb(Regexで/a/に置き換え)を、前は「${weakened}」が検出していましたが、今はどのテストも検出しません。mutatorは、変えたテストが確かめるミュータントにこれを選ばなかったので、別に実行して確かめました。mutator acceptで通さないでください。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。`,
    `::error file=src/core/spec.ts,line=6,title=実行し直したミュータントの結果が想定と違う::前は「${weakened}」が検出していたミュータントc(Regexで/a/に置き換え)を実行し直すと、RuntimeErrorになりました。検出したかを確かめられないので失敗にします。`,
    "::error title=実行し直したミュータントの結果が想定と違う::前はテストが検出していたミュータントeを実行し直すと、結果なしになりました。検出したかを確かめられないので失敗にします。"
  ])
  assert.deepEqual(reviewRerun(base, current, ["a", "d"], rerun), { lines: [], exitCode: 0 })
})

test("DES-TOOLS-003 Pendingのまま残ったミュータントがあれば失敗する", () => {
  assert.deepEqual(reviewPending(new Map([["a", row("Killed")]]), "今の実行"), { lines: [], exitCode: 0 })
  const review = reviewPending(new Map(["a", "b", "c", "d", "e", "f"].map((id) => [id, row("Pending")])), "今の実行")
  assert.equal(review.exitCode, 1)
  assert.match(
    review.lines[0] ?? "",
    /^::error title=実行されなかったミュータントがある::今の実行で、ミュータント6件\(a、b、c、d、eなど\)が/
  )
})

test("DES-TOOLS-003 mutatorのsnapshotの行から、関数の中身のハッシュと状態とkill matrixの印を読む", () => {
  assert.deepEqual(
    snapshotRows({
      rows: [["k1", 0, 1, "h1", "Killed", [3], [3], 12, 0, 1], ["k2", 0, 1, "h2", "Survived", [], [], 3.5], ["broken"], "x"]
    }),
    new Map([
      ["k1", row("Killed", true, "h1")],
      ["k2", row("Survived", false, "h2")]
    ])
  )
  assert.deepEqual(snapshotRows({}), new Map())
})

test("DES-TOOLS-003 mutatorの設定に実行を打ち切る項目があれば失敗する", () => {
  assert.deepEqual(reviewTruncation({}), { lines: [], exitCode: 0 })
  assert.deepEqual(reviewTruncation({ timeBudget: 0, shard: "1/2" }), {
    lines: [
      "::error title=ミューテーションテストの実行を打ち切る設定がある::mutatorの設定にtimeBudget、shardがあります。範囲内のミュータントが実行されずにPendingのまま残ると、テストが弱くなったかを確かめられないので失敗にします。設定から外してください。"
    ],
    exitCode: 1
  })
})
