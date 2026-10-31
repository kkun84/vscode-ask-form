import { Result } from "effect"
import { attachmentName, initialValues, resendMessage } from "../../src/core/form.ts"
import { messages } from "../../src/core/messages.ts"
import { compile } from "../../src/core/validate.ts"
import { deploySpec } from "../fixtures/deploy.ts"

export const query = "api-gatewayを本番にデプロイしたいです。設定をフォームで聞いてください。"
export const reply =
  "ありがとうございます。レプリカ5台、CPU 500m、ローリングで進めます。処理できる量は1,000 req/s(オートスケールで最大2,000 req/s)です。k8s/deploy.yamlを更新します。"
export const followUp =
  "CPUを1000mにして計算し直しました。処理できる量は2,000 req/s、月額の目安は¥40,000です。deploy.yamlのresourcesも更新します。"

export const captions: ReadonlyArray<{ readonly step: string; readonly text: string }> = [
  { step: "1 頼む", text: "「フォームで聞いて」と頼むと…" },
  { step: "2 届く", text: "<em>推測値と根拠</em>つきのフォームが届く" },
  { step: "3 直す", text: "違うところだけ直すと、<em>処理量と費用</em>がすぐ変わる" },
  { step: "4 答える", text: "<em>ボタン1つ</em>で回答。Copilotはそのまま続ける" },
  { step: "5 送り直す", text: "後から直して、<em>差分を送り直せる</em>" }
]

export const resendText = (): { readonly text: string; readonly file: string } => {
  const compiled = compile(deploySpec)
  if (Result.isFailure(compiled)) {
    throw new Error(compiled.failure.join("\n"))
  }
  const answered = { ...initialValues(compiled.success.spec), replicas: 5 }
  const text = resendMessage(compiled.success.spec, answered, { ...answered, cpu: 1000 }, messages("ja"))
  return { text: text ?? "", file: attachmentName(compiled.success.spec.title) }
}
