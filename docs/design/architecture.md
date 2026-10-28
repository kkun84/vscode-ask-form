# アーキテクチャ設計

コードを層に分け、層どうしの依存の向きを決めます。各項目は結合テスト(`test/integration`)か、同じ名前を持つdependency-cruiserの規則(`.dependency-cruiser.cjs`)で検証します。

```text
src/
  core/        設計図・計算式・差分などの純粋な処理
  ui/          フォーム画面(ブラウザで動く)
  mcp/         MCPサーバー(Node.jsで動く)
  extension/
    node/      デスクトップ版の入口
    web/       web版の入口
    shared/    両方の入口が使うVS Code依存の処理
```

## 層の境界

### ARCH-LAYER-001 中核は純粋

`src/core`は`vscode`、Node.jsの組み込みモジュール、ほかの層のどれにも依存しない。

派生元: SPEC-FORM-001, SPEC-FORM-002, SPEC-EXPR-001, SPEC-MCP-006

### ARCH-LAYER-002 画面はブラウザだけで動く

`src/ui`は`src/core`だけに依存し、`vscode`とNode.jsの組み込みモジュールに依存しない。

派生元: SPEC-UI-001, SPEC-EXT-004

### ARCH-LAYER-003 MCPサーバーはVS Codeを知らない

`src/mcp`は`src/core`に依存してよいが、`vscode`、`src/ui`、`src/extension`には依存しない。

派生元: SPEC-MCP-001

### ARCH-LAYER-004 web版の入口はNode.jsを使わない

`src/extension/web`と`src/extension/shared`は、Node.jsの組み込みモジュールと`src/mcp`に依存しない。

派生元: SPEC-EXT-004

### ARCH-LAYER-005 入口は互いに依存しない

`src/extension/node`と`src/extension/web`は互いに依存しない。

派生元: SPEC-EXT-001, SPEC-EXT-004

## 層をまたぐ仕組み

### ARCH-PORT-001 MCPサーバーへの差し込み口

MCPサーバーはVS Codeに依存せずに投稿と待機の表示を行うため、`ChatPoster`(投稿)と`WaitingIndicator`(待機数の通知)をEffectのサービスとして要求する。デスクトップ版の入口がVS Codeを使う実装を与え、テストは記録するだけの実装を与える。

派生元: SPEC-EXT-002, SPEC-EXT-003, SPEC-MCP-008

### ARCH-UI-001 画面の通信は1種類

画面はどの環境でもMCP Appsの画面側の約束事(postMessageによるJSON-RPC)だけで通信する。web版のパネルは、拡張機能がMCP Appsのホスト役を真似て応答する。

派生元: SPEC-EXT-004, SPEC-UI-001
