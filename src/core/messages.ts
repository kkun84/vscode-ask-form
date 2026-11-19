export type Language = "ja" | "en"

export const languageOf = (locale: string | undefined): Language => (locale?.toLowerCase().startsWith("ja") === true ? "ja" : "en")

const ja = {
  submit: "送信",
  dismiss: "キャンセル",
  hold: "保留",
  holdHint: "今は決めません。Copilotは値を決めつけずに進め、必要になったら聞き直します。",
  held: "保留",
  details: "詳細",
  note: "補足を書く",
  noted: "補足",
  noteHint: "選択肢にない答えや、Copilotに伝えたいことを書けます。回答と一緒に届きます。",
  results: "計算結果",
  recommended: "推奨",
  notAnswered: "未回答",
  detailsOf: (label: string) => `${label}の詳しい説明`,
  whyRecommended: "推奨の理由",
  recommendedWas: (value: string) => `推奨: ${value}`,
  backToRecommended: "推奨に戻す",
  answered: "送信しました",
  answeredInChat: "回答せずに閉じました",
  unavailable: "質問に自動で応じる設定(chat.autoReply)が有効なため、質問せずに進めました",
  cancelled: "キャンセルされました",
  expired: "この質問は終了しています",
  unanswered: (labels: ReadonlyArray<string>) => `答えるか保留にしてください: ${labels.join("、")}`,
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
  hold: "Decide later",
  holdHint: "Leave this undecided for now. Copilot will not assume a value and will ask again when it needs one.",
  held: "On hold",
  details: "Details",
  note: "Add a note",
  noted: "Note",
  noteHint: "Write an answer that is not among the options, or anything else Copilot should know. It is sent with your answers.",
  results: "Results",
  recommended: "Recommended",
  notAnswered: "Not answered",
  detailsOf: (label: string) => `Details for ${label}`,
  whyRecommended: "Why recommended",
  recommendedWas: (value: string) => `Recommended: ${value}`,
  backToRecommended: "Use recommended",
  answered: "Sent",
  answeredInChat: "Closed without answering",
  unavailable: "Not asked: the chat.autoReply setting is on, so Copilot continued without your answer",
  cancelled: "Cancelled",
  expired: "This question has ended",
  unanswered: (labels: ReadonlyArray<string>) => `Answer these or choose to decide later: ${labels.join(", ")}`,
  waiting: "Waiting for your answer",
  sending: "Sending…",
  none: "None",
  empty: "(empty)",
  listSeparator: ", ",
  yes: "Yes",
  no: "No"
}

export type Messages = typeof ja

export const messages = (language: Language): Messages => (language === "ja" ? ja : en)
