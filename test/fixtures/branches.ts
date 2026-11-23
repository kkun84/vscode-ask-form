const text = (id: string, label: string, value: string, field: string, anyOf: ReadonlyArray<string>) => ({
  type: "text",
  id,
  label,
  default: value,
  reason: "既存の設定より",
  when: { field, anyOf }
})

export const branchSpec = {
  title: "勤怠アプリの設定",
  fields: [
    text("tenant", "テナントのドメイン", "example.onmicrosoft.com", "auth", ["sso"]),
    {
      type: "choice",
      id: "auth",
      label: "ログインの方式",
      default: "password",
      options: [
        { value: "sso", label: "社内SSO" },
        { value: "password", label: "メールとパスワード" },
        { value: "none", label: "ログインなし" }
      ]
    },
    text("minLength", "パスワードの最小文字数", "12", "auth", ["password"]),
    {
      type: "choice",
      id: "mfaApp",
      label: "使える認証の手段",
      multiple: true,
      default: ["totp"],
      when: { field: "mfa", anyOf: ["required", "optional"] },
      options: [
        { value: "totp", label: "認証アプリ" },
        { value: "sms", label: "SMS" },
        { value: "key", label: "セキュリティキー" }
      ]
    },
    {
      type: "choice",
      id: "mfa",
      label: "二段階認証",
      default: "required",
      when: { field: "auth", anyOf: ["password"] },
      options: [
        { value: "required", label: "必須にする" },
        { value: "optional", label: "任意にする" },
        { value: "off", label: "使わない" }
      ]
    },
    {
      type: "choice",
      id: "notify",
      label: "打刻漏れを知らせる方法",
      multiple: true,
      default: ["mail", "slack"],
      options: [
        { value: "mail", label: "メール" },
        { value: "slack", label: "Slack" },
        { value: "teams", label: "Teams" },
        { value: "sms", label: "SMS" }
      ]
    },
    text("from", "送信元のメールアドレス", "kintai@example.co.jp", "notify", ["mail"]),
    text("channel", "Slackのチャンネル", "#kintai", "notify", ["slack"]),
    { type: "date", id: "release", label: "最初のリリース日", default: "2027-04-01", reason: "計画表より" },
    text("quiet", "通知を止める時間帯", "22:00〜7:00", "notify", ["mail", "sms"])
  ]
} as const
