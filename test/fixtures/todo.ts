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
        {
          value: "browser",
          label: "ブラウザ",
          fields: [
            {
              type: "choice",
              id: "engine",
              label: "保存方式",
              default: "local",
              reason: "件数が少ないため",
              options: [
                { value: "local", label: "localStorage", description: "5MBまで。手軽に始められる" },
                { value: "indexed", label: "IndexedDB", description: "大きなデータも扱える" }
              ]
            }
          ]
        },
        {
          value: "server",
          label: "サーバー",
          fields: [
            { type: "number", id: "port", label: "ポート", default: 3000, min: 1, max: 65535, reason: "package.jsonのdevスクリプトより" },
            {
              type: "choice",
              id: "auth",
              label: "ログイン",
              default: "no",
              options: [
                { value: "yes", label: "必要" },
                { value: "no", label: "不要" }
              ]
            }
          ]
        }
      ],
      default: "browser",
      reason: "README.mdに「まずは自分用」とあるため"
    },
    { type: "number", id: "pageSize", label: "1ページの件数", default: 20, min: 5, max: 100, step: 5, suffix: "件" },
    {
      type: "choice",
      id: "due",
      label: "締め切り",
      default: "yes",
      options: [
        { value: "yes", label: "付けられる" },
        { value: "no", label: "付けない" }
      ]
    }
  ]
} as const
