export type Language = "ja" | "en"

export const languageOf = (locale: string | undefined): Language => (locale?.toLowerCase().startsWith("ja") === true ? "ja" : "en")

const ja = {
  submit: "送信",
  dismiss: "キャンセル",
  held: "回答なし",
  comment: "コメント",
  commentPresets: [
    "他の要件を先に決める。",
    "この質問の意味がわからない。説明が足りない。",
    "インターネットで調査した上でもう一度検討しよう。"
  ] as ReadonlyArray<string>,
  presetsOf: (label: string) => `${label}へのコメントの定型文`,
  clear: "選択を解除",
  clearOf: (label: string) => `${label}の選択を解除`,
  clearTextOf: (label: string) => `${label}を空にする`,
  searchOptions: "入力して絞り込む",
  filterOf: (label: string) => `${label}を絞り込む`,
  noMatches: "一致する選択肢がありません",
  picked: "選んだもの：",
  increase: (label: string) => `${label}を増やす`,
  decrease: (label: string) => `${label}を減らす`,
  scrub: "左右にドラッグして値を変える",
  commentOf: (label: string) => `${label}へのコメント`,
  commentHint: "この質問について、Copilotに伝えたいことを書けます。",
  unsetHint: "答えないときは、理由や、あとで聞いてほしいか、Copilotに決めてほしいかを書けます。",
  details: "詳細",
  note: "補足を書く",
  noteHint: "選択肢にない答えや、Copilotに伝えたいことを書けます。回答と一緒に届きます。",
  results: "計算結果",
  recommended: "推奨",
  notAnswered: "未回答",
  detailsOf: (label: string) => `${label}の詳しい説明`,
  whyRecommended: "推奨の理由",
  backToRecommended: "推奨に戻す",
  unanswered: (labels: ReadonlyArray<string>) => `答えるか、コメントを書いてください: ${labels.join("、")}`,
  waiting: "回答を待っています",
  sending: "送信中…",
  none: "なし",
  empty: "(空欄)",
  listSeparator: "、",
  yes: "はい",
  no: "いいえ"
}

const en: typeof ja = {
  submit: "Send",
  dismiss: "Cancel",
  held: "No answer",
  comment: "Comment",
  commentPresets: [
    "Decide the other requirements first.",
    "I don't understand this question. It needs more explanation.",
    "Research this online, then reconsider it."
  ] as ReadonlyArray<string>,
  presetsOf: (label: string) => `Preset comments for ${label}`,
  clear: "Clear selection",
  clearOf: (label: string) => `Clear selection for ${label}`,
  commentOf: (label: string) => `Comment on ${label}`,
  commentHint: "Write anything Copilot should know about this question.",
  unsetHint: "If you won't answer, say why, and whether Copilot should ask again later or decide for you.",
  details: "Details",
  note: "Add a note",
  noteHint: "Write an answer that is not among the options, or anything else Copilot should know. It is sent with your answers.",
  results: "Results",
  recommended: "Recommended",
  notAnswered: "Not answered",
  detailsOf: (label: string) => `Details for ${label}`,
  whyRecommended: "Why recommended",
  backToRecommended: "Use recommended",
  unanswered: (labels: ReadonlyArray<string>) => `Answer these or comment on them: ${labels.join(", ")}`,
  waiting: "Waiting for your answer",
  sending: "Sending…",
  none: "None",
  empty: "(empty)",
  listSeparator: ", ",
  yes: "Yes",
  no: "No",
  scrub: "Drag left or right to change the value",
  decrease: (label: string) => `Decrease ${label}`,
  increase: (label: string) => `Increase ${label}`,
  clearTextOf: (label: string) => `Clear ${label}`,
  picked: "Selected: ",
  noMatches: "No matching options",
  filterOf: (label: string) => `Filter ${label}`,
  searchOptions: "Type to filter"
}

export type Messages = typeof ja

export const messages = (language: Language): Messages => (language === "ja" ? ja : en)
