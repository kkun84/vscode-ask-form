import { Result } from "effect"
import { attachmentName, initialValues, resendMessage } from "../../src/core/form.ts"
import { messages } from "../../src/core/messages.ts"
import { compile } from "../../src/core/validate.ts"
import { todoSpec } from "../fixtures/todo.ts"

export const query = "TODOアプリを新しく作りたいです。設定をフォームで聞いてください。"
export const reply =
  "ありがとうございます。ReactとlocalStorageで作ります。メモは2,000文字まで、1件は最大4.3 KBなので、約1,190件まで保存できます。src/App.tsxから作り始めます。"
export const followUp = "1ページの件数を50件にしました。一覧の表示とページ送りのテストも合わせて直します。"

export const captions: ReadonlyArray<{ readonly step: string; readonly text: string }> = [
  { step: "1 頼む", text: "「フォームで聞いて」と頼むと…" },
  { step: "2 届く", text: "Copilotが<em>推測値と根拠</em>つきのフォームを作る" },
  { step: "3 直す", text: "違うところだけ直すと、<em>保存できる件数</em>がすぐ変わる" },
  { step: "4 答える", text: "<em>ボタン1つ</em>で回答。Copilotはそのまま続ける" },
  { step: "5 送り直す", text: "後から直して、<em>差分を送り直せる</em>" }
]

export const resendText = (): { readonly text: string; readonly file: string } => {
  const compiled = compile(todoSpec)
  if (Result.isFailure(compiled)) {
    throw new Error(compiled.failure.join("\n"))
  }
  const answered = { ...initialValues(compiled.success.spec), memoMax: 2000 }
  const text = resendMessage(compiled.success.spec, answered, { ...answered, pageSize: 50 }, messages("ja"))
  return { text: text ?? "", file: attachmentName(compiled.success.spec.title) }
}
