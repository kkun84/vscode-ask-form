import { Result } from "effect"
import type { CompiledForm } from "../../src/core/form.ts"
import { compile } from "../../src/core/validate.ts"

export const storageSpec = {
  title: "保存先の設定",
  fields: [
    { type: "text", id: "name", label: "アプリ名", default: "my-todo", reason: "フォルダ名より" },
    {
      type: "choice",
      id: "storage",
      label: "保存先",
      default: "browser",
      reason: "README.mdに「まずは自分用」とあるため",
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
                { value: "local", label: "localStorage" },
                { value: "indexed", label: "IndexedDB" }
              ]
            }
          ]
        },
        {
          value: "server",
          label: "サーバー",
          fields: [
            { type: "number", id: "port", label: "ポート", default: 8080, min: 1, max: 65535, reason: "package.jsonより" },
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
        },
        { value: "none", label: "保存しない" }
      ]
    }
  ],
  computed: [
    { id: "cost", label: "月額", expression: "storage == 'server' ? (auth == 'yes' ? 1500 : 1000) : 0", prefix: "¥", primary: true }
  ]
} as const

export const storageForm: CompiledForm = compile(storageSpec).pipe(Result.getOrThrow)
