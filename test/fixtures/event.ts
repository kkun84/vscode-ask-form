import { Result } from "effect"
import type { CompiledForm } from "../../src/core/form.ts"
import { compile } from "../../src/core/validate.ts"

export const eventSpec = {
  title: "交流会の条件",
  description: "去年の振り返りとREADMEから推測しました。",
  fields: [
    { type: "text", id: "name", label: "イベント名", default: "技術交流会 2026", reason: "README.mdより" },
    {
      type: "choice",
      id: "format",
      label: "形式",
      options: [
        { value: "meetup", label: "交流会" },
        { value: "talk", label: "勉強会" },
        { value: "hack", label: "ハッカソン" }
      ],
      default: "meetup",
      reason: "依頼文より"
    },
    { type: "number", id: "attendees", label: "参加者数", default: 120, min: 20, max: 300, step: 10, suffix: "人" },
    { type: "number", id: "price", label: "参加費", default: 2000, min: 0, max: 5000, step: 500, prefix: "¥" },
    { type: "toggle", id: "stream", label: "ライブ配信", default: true, note: "+¥30,000" },
    {
      type: "choice",
      id: "extras",
      label: "配布物",
      multiple: true,
      options: [
        { value: "sticker", label: "ステッカー" },
        { value: "tshirt", label: "Tシャツ" }
      ],
      default: ["sticker"],
      advanced: true
    },
    { type: "number", id: "venue", label: "会場費", default: 140000, min: 50000, max: 300000, step: 10000, prefix: "¥", advanced: true }
  ],
  computed: [
    { id: "cost", label: "費用", expression: "venue + (stream ? 30000 : 0)", prefix: "¥" },
    { id: "profit", label: "収支", expression: "attendees * price - cost", prefix: "¥", primary: true },
    { id: "breakEven", label: "損益分岐", expression: "price > 0 ? ceil(cost / price) : 0", suffix: "人" }
  ]
} as const

export const eventForm: CompiledForm = compile(eventSpec).pipe(Result.getOrThrow)
