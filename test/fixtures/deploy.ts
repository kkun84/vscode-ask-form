export const deploySpec = {
  title: "本番デプロイの設定",
  description: "k8s/deploy.yamlと直近1週間の負荷から推測しました。",
  fields: [
    { type: "text", id: "service", label: "サービス名", default: "api-gateway", reason: "package.jsonより" },
    {
      type: "choice",
      id: "strategy",
      label: "デプロイ方式",
      options: [
        { value: "rolling", label: "ローリング" },
        { value: "bluegreen", label: "ブルーグリーン" },
        { value: "canary", label: "カナリア" }
      ],
      default: "rolling",
      reason: "k8s/deploy.yamlより"
    },
    {
      type: "number",
      id: "replicas",
      label: "レプリカ数",
      default: 3,
      min: 1,
      max: 20,
      step: 1,
      suffix: "台",
      reason: "直近のピーク負荷より"
    },
    { type: "number", id: "cpu", label: "CPU(1台あたり)", default: 500, min: 250, max: 4000, step: 250, suffix: "m" },
    { type: "toggle", id: "autoscale", label: "オートスケール", default: true, note: "最大2倍" },
    {
      type: "number",
      id: "rpsPerCore",
      label: "1コアの処理量",
      default: 400,
      min: 50,
      max: 2000,
      step: 50,
      suffix: " req/s",
      advanced: true
    }
  ],
  computed: [
    { id: "capacity", label: "処理できる量", expression: "replicas * cpu / 1000 * rpsPerCore", suffix: " req/s", primary: true },
    { id: "peak", label: "ピーク時", expression: "autoscale ? capacity * 2 : capacity", suffix: " req/s" },
    { id: "cost", label: "月額の目安", expression: "replicas * cpu / 1000 * 8000", prefix: "¥" }
  ],
  submitLabel: "この設定で進める"
} as const
