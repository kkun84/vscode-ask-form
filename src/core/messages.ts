export type Language = "ja" | "en"

interface TransferMessageLike {
  readonly type: "grab" | "move" | "drop" | "cancel"
  readonly label: string
  readonly list: string
  readonly position: number
  readonly total: number
}

export const languageOf = (locale: string | undefined): Language => (locale?.toLowerCase().startsWith("ja") === true ? "ja" : "en")

const ja = {
  locale: "ja-JP",
  openCalendar: (label: string) => `${label}のカレンダーを開く`,
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
  rankOf: (label: string) => `${label}を順位に入れる`,
  unrankOf: (label: string) => `${label}を候補に戻す`,
  rankedOf: (label: string) => `${label}の順位`,
  poolOf: (label: string) => `${label}の候補`,
  rankEmpty: "候補を押すと、ここに順に入ります",
  reset: "リセット",
  rankingHint:
    "Enterで順位に入れます。SpaceかEnterで持ち上げ、上下の矢印キーで動かし、左右の矢印キーで順位と候補を移り、もう一度押して置きます。Escで元に戻し、Deleteで候補に戻します。",
  transferMessage: (message: TransferMessageLike): string =>
    message.type === "grab"
      ? `${message.label}を持ち上げました。${message.list}の${message.total}個中${message.position}番目です。`
      : message.type === "move"
        ? `${message.list}の${message.position}番目`
        : message.type === "drop"
          ? `${message.label}を${message.list}の${message.position}番目に置きました。`
          : `${message.label}を元の位置に戻しました。`,
  lowerOf: (label: string) => `${label}の下限`,
  upperOf: (label: string) => `${label}の上限`,
  rangeSeparator: "〜",
  listPlaceholder: "書いてEnterで足す",
  listHint: "1つ書くごとにEnterで足します。Backspaceか×で消します。",
  listDuplicate: (text: string) => `「${text}」は既にあります`,
  listTooLong: (max: number) => `1つは${max}文字までです`,
  listFull: (max: number) => `${max}個まで足せます`,
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
  openCalendar: (label: string) => `Open the calendar for ${label}`,
  locale: "en-US",
  scrub: "Drag left or right to change the value",
  decrease: (label: string) => `Decrease ${label}`,
  increase: (label: string) => `Increase ${label}`,
  clearTextOf: (label: string) => `Clear ${label}`,
  reset: "Reset",
  rankEmpty: "Choose a candidate to rank it here",
  poolOf: (label: string) => `Candidates for ${label}`,
  rankedOf: (label: string) => `Ranking for ${label}`,
  unrankOf: (label: string) => `Move ${label} back to the candidates`,
  rankOf: (label: string) => `Rank ${label}`,
  rankingHint:
    "Press Enter to rank it. Press Space or Enter to pick it up, move it with the up and down arrows, switch between the ranking and the candidates with the left and right arrows, and press again to drop it. Escape puts it back, and Delete returns it to the candidates.",
  transferMessage: (message: TransferMessageLike): string =>
    message.type === "grab"
      ? `Picked up ${message.label}, position ${message.position} of ${message.total} in ${message.list}.`
      : message.type === "move"
        ? `Position ${message.position} of ${message.total} in ${message.list}.`
        : message.type === "drop"
          ? `Dropped ${message.label} at position ${message.position} of ${message.total} in ${message.list}.`
          : `Put ${message.label} back.`
  rangeSeparator: " – ",
  upperOf: (label: string) => `Maximum ${label}`,
  lowerOf: (label: string) => `Minimum ${label}`
  listFull: (max: number) => `You can add up to ${max}`,
  listTooLong: (max: number) => `Each entry can be up to ${max} characters`,
  listDuplicate: (text: string) => `"${text}" is already in the list`,
  listHint: "Press Enter after each entry. Remove one with Backspace or ×.",
  listPlaceholder: "Type and press Enter"
}

export type Messages = typeof ja

export const messages = (language: Language): Messages => (language === "ja" ? ja : en)
