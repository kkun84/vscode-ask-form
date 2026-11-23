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
  it("DES-UI-003 筋を、選んで続きの質問を出している一番上の選択肢から、最後の続きの質問まで引き、選択肢からは左から下へ、続きの質問へは下から右へ角を丸めて曲げ、点は選択肢の枠の縁に置き、出さない選択肢の点は中を抜く", () => {
    const { shapes, revealing } = branchShapes([lane, { ...lane, depth: 1, followUps: [lane.followUps[1]!], options: [] }])
    assert.deepEqual(paths(shapes, false).slice(0, 6), [
      "M 8 108 V 492 Q 8 500 16 500 H 30",
      "M 8 292 Q 8 300 16 300 H 30",
      "M 8 392 Q 8 400 16 400 H 30",
      "M 40 100 H 16 Q 8 100 8 108",
      "M 40 130 H 16 Q 8 130 8 138",
      "M 40 190 H 16 Q 8 190 8 198"
    ])
    assert.deepEqual(
      shapes.flatMap((shape) => (shape.kind === "dot" ? [[shape.x, shape.y, shape.filled]] : [])),
      [
        [40, 100, true],
        [40, 130, true],
        [40, 160, false],
        [40, 190, true]
      ]
    )
    assert.equal(paths(shapes, false)[6], "M 18 10 V 392 Q 18 400 26 400 H 30")
    assert.deepEqual(revealing, [])
  })

  it("DES-UI-003 強調する質問の線は、その質問を出している選択肢からだけ引く", () => {
    const { shapes, revealing } = branchShapes([lane], "quiet")
    assert.deepEqual(paths(shapes, true), [
      "M 40 100 H 16 Q 8 100 8 108 V 492 Q 8 500 16 500 H 30",
      "M 40 190 H 16 Q 8 190 8 198 V 492 Q 8 500 16 500 H 30"
    ])
    assert.deepEqual(revealing, ["mail", "sms"])
    assert.deepEqual(branchShapes([lane], "missing").revealing, [])
  })

  it("DES-UI-003 続きの質問の見出しが角の丸みより筋に近くても、線を左へ折り返さずに角の終わりで止める", () => {
    const near = { ...lane, options: [], followUps: [{ id: "from", anyOf: ["mail"], x: 14, y: 300 }] }
    assert.deepEqual(paths(branchShapes([near]).shapes, false), ["M 8 10 V 292 Q 8 300 16 300 H 16"])
  })
})
