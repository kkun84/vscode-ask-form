# アーキテクチャ設計

コードを層に分け、層どうしの依存の向きを決めます。規則はfallowで検査します。層どうしの向きと循環参照は`.fallowrc.json`の`boundaries`に、外部モジュールへの依存は項目と同じIDを持つ`architecture.rules.json`の規則に書きます。各項目は、わざと規則を破るコードを足すとfallowがそれを見つけることを、結合テスト(`test/integration`)で確かめます。

```text
src/
  core/        設計図・計算式・差分・パネルのホスト役などの純粋な処理
  ui/          フォーム画面(ブラウザで動く)
  extension/
    node/      拡張機能の入口
    shared/    VS Code依存の処理(ツールとパネル)
```

依存は次の向きにだけ流れます。

```text
extension/node ──▶ extension/shared ──▶ core ◀── ui
```

## 層の境界

### ARCH-CYCLE-001 循環参照がない

どのモジュールも、自分自身に戻ってくる依存の輪を作らない。型だけの依存も含める。

派生元: SPEC-TOOL-001

### ARCH-LAYER-001 中核は純粋

`src/core`は`effect`と`src/core`のほかに依存しない。`vscode`、Node.jsの組み込みモジュール、ほかの層には依存しない。

- 予約語の`id`と複数選択の重複は中核のSchemaと検査で拒否する。ツールの入力は同じ検査を通し、画面からの回答も計算に渡す前に重複を検査する。

派生元: SPEC-FORM-001, SPEC-FORM-002, SPEC-EXPR-001, SPEC-TOOL-006

### ARCH-LAYER-002 画面はブラウザだけで動く

`src/ui`は`src/ui`と、ARCH-LAYER-006 のEffectを使わない中核だけに依存する。設計図の型だけは参照してよい。

派生元: SPEC-UI-001, SPEC-EXT-004, SPEC-EXT-005

### ARCH-LAYER-006 画面が使う中核はEffectを使わない

`src/core`のうち`expression.ts`、`form.ts`、`hash.ts`、`messages.ts`は、実行時にはこの4つのほかに依存しない。画面のバンドルを小さく保つため。

- 数値リテラルの有限性、NUL文字を含む複数選択の差分、`__proto__`を含む計算結果の保持は、この純粋な処理にまとめる。画面と回答を作る側で同じ処理を使い、依存を増やさない。

派生元: SPEC-EXT-005, SPEC-UI-002, SPEC-EXPR-001, SPEC-TOOL-003

## 依存

### ARCH-DEPS-001 配布物の依存は限られる

`src`は`effect`と`vscode`のほかの外部パッケージ、開発用の依存、`test`と`scripts`に依存しない。ただし`src/ui`は、画面の部品の振る舞いに`@ui-sdk/core`と`@ui-sdk/web`を使う。解決できない依存を持たない。

- UI SDKはbetaなので、版数を固定し、上げる時はまとめて追従する。

- 検査の時間制限とプロセスグループの終了は`scripts`に置き、Node.jsとOSの機能で行う。配布物の依存は増やさない。

派生元: SPEC-EXT-005

### ARCH-NET-001 通信の口を開かない

`src`は、通信を待ち受けたり接続したりするNode.jsのモジュール(`net`、`http`、`https`、`http2`、`dgram`、`tls`)を読み込まない。回答はVS Codeのパネルの通信だけで受け取るので、同じPCのほかのプログラムやWebページが回答を送り込める口がない。

派生元: SPEC-UI-010

## 層をまたぐ仕組み

### ARCH-UI-001 画面の通信は1種類

画面はMCP Appsの画面側の約束事(postMessageによるJSON-RPC)だけで通信する。パネルでは、拡張機能がMCP Appsのホスト役を真似て応答する(`src/core/appHost.ts`)。画面は、チャットの中に描かれる前提で作った頃の通信の形をそのまま使う。

- 画面の共通ブリッジが送り主とoriginを検証する。VS Code固有の送り主の橋渡しはパネルのHTMLに閉じ込める。
- 回答の受け付けの状態(待機中、回答済み、中断)は中核のホスト役が持つ。画面は、受け付けの結果を`form_answer`の返答でだけ知る。回答後や中断ではパネルごと閉じるので、ホスト役は結果や中断を画面に通知しない。

- web受け入れテストは拡張機能とブラウザの完了をテスト側で合流させ、片方の成功だけで終了しない。

派生元: SPEC-EXT-004, SPEC-UI-001, SPEC-UI-006, SPEC-UI-010

## リリース

### ARCH-REL-001 検出と公開の権限を分ける

- ワークフローの先頭のdetectジョブはcontents:readで版数、mainの先頭、originのタグを確認し、actionにrelease、bump、noneのいずれかを出力する。bumpジョブはactionがbumpの場合だけ動き、`GITHUB_TOKEN`はcontents:readに留め、ContentsとPull requestsだけを書けるGitHub Appのトークンで版数を上げるリリースPRを作る。書き込み権限を持つreleaseジョブはdetectに依存し、actionがreleaseの場合だけ公開する。ワークフロー全体をconcurrencyグループreleaseで直列化し、cancel-in-progressはfalseとする。

派生元: SPEC-REL-001
