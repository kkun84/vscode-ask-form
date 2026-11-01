export const todoSpec = {
  title: "TODOアプリの設定",
  description: "README.mdのメモから推測しました。",
  fields: [
    { type: "text", id: "name", label: "アプリ名", default: "my-todo", reason: "フォルダ名より" },
    {
      type: "choice",
      id: "framework",
      label: "画面の作り方",
      options: [
        { value: "react", label: "React" },
        { value: "vue", label: "Vue" },
        { value: "svelte", label: "Svelte" }
      ],
      default: "react",
      reason: "README.mdに「Reactで」とあるため"
    },
    {
      type: "choice",
      id: "storage",
      label: "保存先",
      options: [
        { value: "browser", label: "ブラウザ" },
        { value: "server", label: "サーバー" }
      ],
      default: "browser",
      reason: "README.mdに「まずは自分用」とあるため"
    },
    { type: "number", id: "memoMax", label: "メモの最大文字数", default: 1000, min: 0, max: 5000, step: 500, suffix: "文字" },
    { type: "number", id: "pageSize", label: "1ページの件数", default: 20, min: 5, max: 100, step: 5, suffix: "件" },
    { type: "toggle", id: "due", label: "締め切りを付けられる", default: true },
    {
      type: "number",
      id: "titleMax",
      label: "タイトルの最大文字数",
      default: 100,
      min: 20,
      max: 500,
      step: 10,
      suffix: "文字",
      advanced: true
    }
  ],
  computed: [
    { id: "size", label: "1件の最大サイズ", expression: "round(((titleMax + memoMax) * 2 + 200) / 1024, 1)", suffix: " KB", decimals: 1 },
    { id: "capacity", label: "ブラウザに保存できる件数", expression: "floor(5120 / size)", suffix: " 件", primary: true }
  ],
  submitLabel: "この設定で作る"
} as const
