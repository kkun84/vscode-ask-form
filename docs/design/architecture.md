# アーキテクチャ設計

コードを層に分け、層どうしの依存の向きを決めます。規則はfallowで検査します。層どうしの向きと循環参照は`.fallowrc.json`の`boundaries`に、外部モジュールへの依存は項目と同じIDを持つ`architecture.rules.json`の規則に書きます。各項目は、わざと規則を破るコードを足すとfallowがそれを見つけることを、結合テスト(`test/integration`)で確かめます。

```text
src/
  core/        設計図・計算式・差分などの純粋な処理
  ui/          フォーム画面(ブラウザで動く)
  mcp/         MCPサーバー(Node.jsで動く)
    ports.ts   VS Codeへの差し込み口(Effectのサービスの定義)
    pending.ts 待機の台帳(サービスと実装)
    server.ts  ツールとリソース(サービスを要求するだけ)
    http.ts    層を組み立ててHTTPで公開する
  extension/
    node/      デスクトップ版の入口。差し込み口の実装を与える
    web/       web版の入口
    shared/    両方の入口が使うVS Code依存の処理
```

依存は次の向きにだけ流れます。Effectの層は入口で組み立て、内側の層はサービスを要求するだけにします。

```text
extension/node ──▶ mcp/http ──▶ mcp/server ──▶ mcp/pending ──▶ mcp/ports ──▶ core
extension/web  ──▶ extension/shared ──▶ core ◀── ui
```

## 層の境界

### ARCH-CYCLE-001 循環参照がない

どのモジュールも、自分自身に戻ってくる依存の輪を作らない。型だけの依存も含める。

派生元: SPEC-MCP-001, SPEC-EXT-001

### ARCH-LAYER-001 中核は純粋

`src/core`は`effect`と`src/core`のほかに依存しない。`vscode`、Node.jsの組み込みモジュール、ほかの層には依存しない。

- 予約語の`id`と複数選択の重複は中核のSchemaと検査で拒否する。デスクトップ版とweb版は同じ検査を通し、画面からの回答も計算に渡す前に重複を検査する。

派生元: SPEC-FORM-001, SPEC-FORM-002, SPEC-EXPR-001, SPEC-MCP-006

### ARCH-LAYER-002 画面はブラウザだけで動く

`src/ui`は`src/ui`と、ARCH-LAYER-006 のEffectを使わない中核だけに依存する。設計図の型だけは参照してよい。

派生元: SPEC-UI-001, SPEC-EXT-004, SPEC-EXT-005

### ARCH-LAYER-003 MCPサーバーはVS Codeを知らない

`src/mcp`は`vscode`、`src/ui`、`src/extension`に依存しない。

派生元: SPEC-MCP-001

### ARCH-LAYER-004 web版の入口はNode.jsを使わない

`src/extension/web`と`src/extension/shared`は、Node.jsの組み込みモジュールと`src/mcp`に依存しない。

- 投稿ごとの一意な保存先ディレクトリは共有の投稿処理で作り、両方の入口でWeb Cryptoを使う。添付名は題名由来の`<slug>.json`に保ち、UUIDはディレクトリ名に使う。ファイル操作はVS CodeのAPIに集める。

派生元: SPEC-EXT-004, SPEC-EXT-003

### ARCH-LAYER-005 入口は互いに依存しない

`src/extension/node`と`src/extension/web`は互いに依存しない。

派生元: SPEC-EXT-001, SPEC-EXT-004

### ARCH-LAYER-006 画面が使う中核はEffectを使わない

`src/core`のうち`expression.ts`、`form.ts`、`hash.ts`、`messages.ts`は、実行時にはこの4つのほかに依存しない。画面のバンドルを小さく保つため。

- 数値リテラルの有限性、NUL文字を含む複数選択の差分、`__proto__`を含む計算結果の保持は、この純粋な処理にまとめる。画面と回答を作る側で同じ処理を使い、依存を増やさない。

派生元: SPEC-EXT-005, SPEC-UI-002, SPEC-EXPR-001, SPEC-MCP-003, SPEC-UI-005

## Effectの層

### ARCH-EFFECT-001 サービスの定義は実装を知らない

`src/mcp/ports.ts`は`effect`と、ARCH-LAYER-006 の中核だけに依存する。

派生元: SPEC-EXT-002, SPEC-EXT-003

### ARCH-EFFECT-002 ツールの処理は通信手段を知らない

`src/mcp/server.ts`、`src/mcp/pending.ts`、`src/mcp/schema.ts`は、Node.jsの組み込みモジュールと`src/mcp/http.ts`に依存しない。

- 待機の台帳の更新と回答の確定は`PendingForms`内で中断不可にし、差し込み口への待機数の通知は確定後の中断可能な処理に分ける。

派生元: SPEC-MCP-003, SPEC-MCP-005, SPEC-MCP-009

### ARCH-EFFECT-003 層を組み立てるのは入口だけ

`src/mcp/http.ts`に依存してよいのは、デスクトップ版の入口(`src/extension/node`)とテストだけ。

- Node.jsの待ち受けエラーはHTTPの境界で型のあるEffectの失敗に変換し、入口へ伝える。内部のツールやサービスにNode.jsのイベントを持ち込まない。

派生元: SPEC-EXT-001

### ARCH-DEPS-001 配布物の依存は限られる

`src`は`effect`と`vscode`のほかの外部パッケージ、開発用の依存、`test`と`scripts`に依存しない。解決できない依存を持たない。

- 検査の時間制限とプロセスグループの終了は`scripts`に置き、Node.jsとOSの機能で行う。配布物の依存は増やさない。

派生元: SPEC-EXT-005

## 層をまたぐ仕組み

### ARCH-PORT-001 MCPサーバーへの差し込み口

MCPサーバーはVS Codeに依存せずに投稿と待機の表示を行うため、`ChatPoster`(投稿)と`WaitingIndicator`(待機数の通知)をEffectのサービスとして要求する。デスクトップ版の入口がVS Codeを使う実装を与え、テストは記録するだけの実装を与える。

派生元: SPEC-EXT-002, SPEC-EXT-003, SPEC-MCP-008

### ARCH-UI-001 画面の通信は1種類

画面はどの環境でもMCP Appsの画面側の約束事(postMessageによるJSON-RPC)だけで通信する。web版のパネルは、拡張機能がMCP Appsのホスト役を真似て応答する。

- 画面の共通ブリッジが送り主とoriginを検証する。VS Code固有の送り主の橋渡しはweb版の入口に閉じ込める。
- 中断の保持と初期化後の再通知は中核のホスト役が担当し、web版の入口は取り消しをホストへ渡す。

派生元: SPEC-EXT-004, SPEC-UI-001, SPEC-UI-006, SPEC-UI-010
