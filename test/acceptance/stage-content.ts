import { Result } from "effect"
import { attachmentName, initialValues, resendMessage } from "../../src/core/form.ts"
import { messages } from "../../src/core/messages.ts"
import { compile } from "../../src/core/validate.ts"
import { todoSpec } from "../fixtures/todo.ts"

export const query = "TODOアプリを新しく作りたいです。設定をフォームで聞いてください。"
export const reply =
  "ありがとうございます。ReactとlocalStorageで作ります。メモは5,000文字までなので、1件は最大10.2 KB、保存できるのは約501件です。src/App.tsxから作り始めます。"
export const followUp = "1ページの件数を50件にしました。一覧の表示とページ送りのテストも合わせて直します。"

export const captions: ReadonlyArray<{ readonly step: string; readonly text: string }> = [
  { step: "1 頼む", text: "設定を決めたいとき、「フォームで聞いて」と頼むと…" },
  { step: "2 届く", text: "質問がフォームで届く。<em>AIの案</em>と出どころが入っている" },
  { step: "3 試す", text: "値を動かすと、<em>決める前に結果が分かる</em>" },
  { step: "4 答える", text: "<em>ボタン1つ</em>で回答。Copilotはそのまま作り始める" },
  { step: "5 直す", text: "あとで変えたくなっても、<em>変えた所だけ</em>伝えられる" }
]

export const resendText = (): { readonly text: string; readonly file: string } => {
  const compiled = compile(todoSpec)
  if (Result.isFailure(compiled)) {
    throw new Error(compiled.failure.join("\n"))
  }
  const answered = { ...initialValues(compiled.success.spec), memoMax: 5000 }
  const text = resendMessage(compiled.success.spec, answered, { ...answered, pageSize: 50 }, messages("ja"))
  return { text: text ?? "", file: attachmentName(compiled.success.spec.title) }
}
