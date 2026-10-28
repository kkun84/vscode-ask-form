import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { evaluate, parse, references, type Expr, type Value } from "../../src/core/expression.ts"

const parsed = (source: string): Expr => {
  const result = parse(source)
  assert.ok(result.ok, `parse failed: ${source}`)
  return result.expr
}

const run = (source: string, scope: Record<string, Value> = {}): Value | undefined =>
  evaluate(parsed(source), new Map(Object.entries(scope)))

describe("DES-EXPR-001 字句と構文", () => {
  it("DES-EXPR-001 演算子の優先順位どおりに解析する", () => {
    assert.equal(run("1 + 2 * 3"), 7)
    assert.equal(run("(1 + 2) * 3"), 9)
    assert.equal(run("10 - 4 - 3"), 3)
    assert.equal(run("1 < 2 && 3 > 2 || false"), true)
    assert.equal(run("true ? 1 : 0 ? 2 : 3"), 1)
  })

  it("DES-EXPR-001 文字列、真偽値、関数呼び出しを解析する", () => {
    assert.equal(run("'a' == \"a\""), true)
    assert.equal(run("!false"), true)
    assert.equal(run("max(1, 5, 3)"), 5)
  })

  it("DES-EXPR-001 参照している名前を列挙する", () => {
    assert.deepEqual(references(parsed("a * b + max(c, 1) > 0 ? d : e")), ["a", "b", "c", "d", "e"])
  })

  it("DES-EXPR-001 誤りを位置つきで返す", () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ["1 +", 3],
      ["1 $ 2", 2],
      ["(1 + 2", 6],
      ["'abc", 0],
      ["foo(1)", 0],
      ["1 2", 2]
    ]
    for (const [source, position] of cases) {
      const result = parse(source)
      assert.equal(result.ok, false, source)
      if (!result.ok) {
        assert.equal(result.error.position, position, source)
      }
    }
  })
})

describe("DES-EXPR-002 評価", () => {
  it("DES-EXPR-002 値の表を参照して評価する", () => {
    assert.equal(run("attendees * price - venue", { attendees: 120, price: 2000, venue: 140000 }), 100000)
    assert.equal(run("stream ? 30000 : 0", { stream: true }), 30000)
    assert.equal(run("kind == 'meetup'", { kind: "meetup" }), true)
  })

  it("DES-EXPR-002 関数を評価する", () => {
    assert.equal(run("min(3, 1, 2)"), 1)
    assert.equal(run("abs(-4)"), 4)
    assert.equal(run("floor(2.7) + ceil(2.1)"), 5)
    assert.equal(run("round(2.345, 2)"), 2.35)
    assert.equal(run("round(2.5)"), 3)
  })

  it("DES-EXPR-002 評価できないものは未定義にする", () => {
    assert.equal(run("1 / 0"), undefined)
    assert.equal(run("5 % 0"), undefined)
    assert.equal(run("'a' * 2"), undefined)
    assert.equal(run("missing + 1"), undefined)
    assert.equal(run("1 ? 2 : 3"), undefined)
    assert.equal(run("abs(1, 2)"), undefined)
    assert.equal(run("1e308 * 10"), undefined)
    assert.equal(run("'a' < 'b'"), undefined)
  })

  it("DES-EXPR-002 論理演算は短絡評価する", () => {
    assert.equal(run("false && missing"), false)
    assert.equal(run("true || missing"), true)
  })
})
