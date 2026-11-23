const languages = ["TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "Kotlin", "Swift", "Ruby", "PHP"].map((label) => ({
  value: label.toLowerCase(),
  label
}))

export const kindsSpec = {
  title: "質問の型",
  description: "質問の型をすべて含むフォームです。",
  fields: [
    {
      type: "choice",
      id: "storage",
      label: "保存先",
      options: [
        { value: "browser", label: "ブラウザ" },
        { value: "server", label: "サーバー" }
      ],
      default: "browser",
      reason: "まずは自分用のため"
    },
    { type: "number", id: "port", label: "ポート", default: 3000, min: 1, max: 65535, when: { field: "storage", anyOf: ["server"] } },
    {
      type: "ranking",
      id: "order",
      label: "優先順位",
      default: ["auth", "api"],
      reason: "依存の順",
      options: [
        { value: "ui", label: "画面" },
        { value: "api", label: "API" },
        { value: "auth", label: "ログイン" },
        { value: "docs", label: "文書" }
      ]
    },
    { type: "searchChoice", id: "langs", label: "言語", multiple: true, default: ["go"], reason: "go.modより", options: languages },
    { type: "textList", id: "ignore", label: "除外するパス", default: ["dist", "node_modules"], reason: ".gitignoreより" },
    { type: "numberRange", id: "node", label: "Node.jsの版", min: 16, max: 24, step: 1, default: [18, 22], reason: "LTSのため" },
    {
      type: "date",
      id: "release",
      label: "リリース日",
      default: "2026-12-01",
      min: "2026-11-25",
      max: "2027-03-31",
      reason: "スプリントの終わり"
    },
    { type: "time", id: "deploy", label: "デプロイの時刻", default: "10:00", min: "09:00", max: "18:00", step: 30, reason: "始業後" },
    {
      type: "treeChoice",
      id: "scope",
      label: "検査する範囲",
      multiple: true,
      default: ["src/ui"],
      reason: "差分より",
      nodes: [
        {
          value: "src",
          label: "src",
          children: [
            { value: "src/ui", label: "ui" },
            { value: "src/core", label: "core" }
          ]
        },
        { value: "README.md", label: "README.md" }
      ]
    }
  ]
} as const

export const unrecommendedSpec = {
  title: "推奨のない質問",
  fields: [
    {
      type: "choice",
      id: "framework",
      label: "画面の作り方",
      options: [
        { value: "react", label: "React" },
        { value: "vue", label: "Vue" }
      ]
    }
  ]
} as const
