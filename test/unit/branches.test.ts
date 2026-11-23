import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { branchShapes, type PlacedLane } from "../../src/ui/branches.ts"

const lane: PlacedLane<string> = {
  depth: 0,
  anchorY: 10,
  options: [
    { value: "mail", selected: true, x: 40, y: 100, ref: "mail" },
    { value: "slack", selected: true, x: 40, y: 130, ref: "slack" },
    { value: "teams", selected: false, x: 40, y: 160, ref: "teams" },
    { value: "sms", selected: true, x: 40, y: 190, ref: "sms" }
  ],
  followUps: [
    { id: "from", anyOf: ["mail"], x: 30, y: 300 },
    { id: "channel", anyOf: ["slack"], x: 30, y: 400 },
    { id: "quiet", anyOf: ["mail", "sms"], x: 30, y: 500 }
  ]
}

const paths = (shapes: ReturnType<typeof branchShapes>["shapes"], lit: boolean) =>
  shapes.flatMap((shape) => (shape.kind === "path" && shape.lit === lit ? [shape.d] : []))

describe("DES-UI-003 続きの質問の線", () => {
  it("DES-UI-003 筋を、選んで続きの質問を出している一番上の選択肢から、最後の続きの質問まで引き、出さない選択肢の点は中を抜く", () => {
    const { shapes, revealing } = branchShapes([lane, { ...lane, depth: 1, followUps: [lane.followUps[1]!], options: [] }])
    assert.deepEqual(paths(shapes, false).slice(0, 6), [
      "M 10 100 V 494 Q 10 500 16 500 H 30",
      "M 10 300 H 30",
      "M 10 400 H 30",
      "M 10 100 H 40",
      "M 10 130 H 40",
      "M 10 190 H 40"
    ])
    assert.deepEqual(
      shapes.flatMap((shape) => (shape.kind === "dot" ? [[shape.y, shape.filled]] : [])),
      [
        [100, true],
        [130, true],
        [160, false],
        [190, true]
      ]
    )
    assert.equal(paths(shapes, false)[6], "M 22 10 V 394 Q 22 400 28 400 H 30")
    assert.deepEqual(revealing, [])
  })

  it("DES-UI-003 強調する質問の線は、その質問を出している選択肢からだけ引く", () => {
    const { shapes, revealing } = branchShapes([lane], "quiet")
    assert.deepEqual(paths(shapes, true), ["M 40 100 H 10 V 494 Q 10 500 16 500 H 30", "M 40 190 H 10 V 494 Q 10 500 16 500 H 30"])
    assert.deepEqual(revealing, ["mail", "sms"])
    assert.deepEqual(branchShapes([lane], "missing").revealing, [])
  })
})
