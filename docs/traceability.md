# トレーサビリティ

`node scripts/traceability.ts --write`で生成します。手で編集しません。

## 要求仕様

| ID | 名前 | 派生元 | 派生先 | 検証 |
| --- | --- | --- | --- | --- |
| REQ-ASK-001 | フォームで質問できる | - | SPEC-FORM-001, SPEC-FORM-002, SPEC-MCP-001, SPEC-MCP-002, SPEC-MCP-004, SPEC-EXT-001 | `test/acceptance/chat.ts`, MAT-ASK-001 |
| REQ-ASK-002 | 推測値と根拠が見える | - | SPEC-FORM-001, SPEC-UI-001 | `test/acceptance/chat.ts`, MAT-ASK-001 |
| REQ-ASK-003 | 結果がその場で変わる | - | SPEC-FORM-001, SPEC-EXPR-001, SPEC-UI-002 | MAT-ASK-001 |
| REQ-ANS-001 | 1回の操作で回答が届く | - | SPEC-MCP-001, SPEC-MCP-003, SPEC-MCP-005, SPEC-MCP-006, SPEC-UI-003 | `test/acceptance/chat.ts`, MAT-ANS-001 |
| REQ-ANS-002 | AIに任せられる | - | SPEC-MCP-003, SPEC-UI-003 | `test/acceptance/chat.ts`, MAT-ANS-002 |
| REQ-ANS-003 | チャットで答えられる | - | SPEC-MCP-003, SPEC-UI-003 | `test/acceptance/chat.ts`, MAT-ANS-002 |
| REQ-ANS-004 | キーボードだけで回答できる | - | SPEC-UI-003, SPEC-UI-008 | MAT-ANS-001 |
| REQ-RES-001 | 回答の要約が残る | - | SPEC-UI-004 | `test/acceptance/chat.ts`, MAT-RES-001 |
| REQ-RES-002 | 変更して送り直せる | - | SPEC-MCP-008, SPEC-UI-005, SPEC-EXT-003 | `test/acceptance/chat.ts`, MAT-RES-001 |
| REQ-RES-003 | 同じ内容は送り直せない | - | SPEC-MCP-008, SPEC-UI-005 | `test/acceptance/chat.ts`, MAT-RES-001 |
| REQ-CANCEL-001 | 中断が分かる | - | SPEC-MCP-005, SPEC-MCP-007, SPEC-UI-006, SPEC-UI-010, SPEC-EXT-004 | `test/acceptance/chat.ts`, MAT-CANCEL-001 |
| REQ-WAIT-001 | 回答待ちが分かる | - | SPEC-EXT-002 | `test/acceptance/chat.ts`, MAT-CANCEL-001 |
| REQ-WEB-001 | web版でも回答できる | - | SPEC-EXT-004, SPEC-EXT-006 | `test/acceptance/web.ts`, MAT-WEB-001 |
| REQ-PERF-001 | 軽い | - | SPEC-EXT-005 | `test/acceptance/desktop.ts`, MAT-PERF-001 |
| REQ-SEC-001 | 回答を偽装されない | - | SPEC-MCP-009, SPEC-UI-010, SPEC-EXT-001 | MAT-SEC-001 |
| REQ-LOOK-001 | VS Codeに馴染む | - | SPEC-UI-007, SPEC-UI-009 | MAT-LOOK-001 |
| REQ-A11Y-001 | 支援技術で使える | - | SPEC-UI-008 | MAT-LOOK-001 |
| REQ-DIST-001 | リリースを配布する | - | SPEC-REL-001 | MAT-DIST-001 |

## システム仕様

| ID | 名前 | 派生元 | 派生先 | 検証 |
| --- | --- | --- | --- | --- |
| SPEC-FORM-001 | 設計図の形 | REQ-ASK-001, REQ-ASK-002, REQ-ASK-003 | ARCH-LAYER-001, DES-SPEC-001, DES-FORM-002 | `test/system/form.test.ts` |
| SPEC-FORM-002 | 設計図の意味的な検査 | REQ-ASK-001 | ARCH-LAYER-001, DES-SPEC-001, DES-EXPR-001 | `test/system/form.test.ts` |
| SPEC-EXPR-001 | 計算式 | REQ-ASK-003 | ARCH-LAYER-001, ARCH-LAYER-006, DES-EXPR-001, DES-EXPR-002, DES-FORM-002 | `test/system/form.test.ts` |
| SPEC-MCP-001 | 質問のツール | REQ-ASK-001, REQ-ANS-001 | ARCH-CYCLE-001, ARCH-LAYER-003 | `test/system/mcp.test.ts` |
| SPEC-MCP-002 | 画面のリソース | REQ-ASK-001 | - | `test/system/mcp.test.ts` |
| SPEC-MCP-003 | 回答を待つ | REQ-ANS-001, REQ-ANS-002, REQ-ANS-003 | ARCH-LAYER-006, ARCH-EFFECT-002, DES-FORM-003, DES-PEND-001 | `test/system/mcp.test.ts` |
| SPEC-MCP-004 | 設計図の誤り | REQ-ASK-001 | DES-SPEC-001 | `test/system/mcp.test.ts` |
| SPEC-MCP-005 | 回答を受け取るツール | REQ-ANS-001, REQ-CANCEL-001 | ARCH-EFFECT-002, DES-FORM-004, DES-PEND-001 | `test/system/mcp.test.ts` |
| SPEC-MCP-006 | フォームの鍵 | REQ-ANS-001 | ARCH-LAYER-001, DES-SPEC-002 | `test/system/mcp.test.ts` |
| SPEC-MCP-007 | 中断 | REQ-CANCEL-001 | DES-PEND-001 | `test/system/mcp.test.ts` |
| SPEC-MCP-008 | 送り直しのツール | REQ-RES-002, REQ-RES-003 | ARCH-EFFECT-001, ARCH-PORT-001, DES-FORM-005, DES-CHAT-001 | `test/system/mcp.test.ts` |
| SPEC-MCP-009 | 接続の保護 | REQ-SEC-001 | ARCH-EFFECT-002, DES-HTTP-001 | `test/system/mcp.test.ts` |
| SPEC-UI-001 | 初期表示 | REQ-ASK-002 | ARCH-LAYER-002, ARCH-UI-001, DES-FORM-001, DES-FORM-003 | `test/system/ui.spec.ts` |
| SPEC-UI-002 | 計算結果 | REQ-ASK-003 | ARCH-LAYER-006, DES-FORM-002 | `test/system/ui.spec.ts` |
| SPEC-UI-003 | 回答の操作 | REQ-ANS-001, REQ-ANS-002, REQ-ANS-003, REQ-ANS-004 | - | `test/system/ui.spec.ts` |
| SPEC-UI-004 | 回答後の要約 | REQ-RES-001 | - | `test/system/ui.spec.ts` |
| SPEC-UI-005 | 送り直し | REQ-RES-002, REQ-RES-003 | ARCH-LAYER-006, ARCH-PORT-001, ARCH-UI-001, DES-FORM-003 | `test/system/ui.spec.ts` |
| SPEC-UI-006 | 中断と期限切れ | REQ-CANCEL-001 | ARCH-UI-001, DES-UI-001, DES-HOST-001 | `test/system/ui.spec.ts` |
| SPEC-UI-007 | テーマ | REQ-LOOK-001 | - | `test/system/ui.spec.ts` |
| SPEC-UI-008 | アクセシビリティ | REQ-A11Y-001, REQ-ANS-004 | - | `test/system/ui.spec.ts` |
| SPEC-UI-009 | 表示の言語 | REQ-LOOK-001 | - | `test/system/ui.spec.ts` |
| SPEC-UI-010 | 画面への通知の送り主 | REQ-SEC-001, REQ-CANCEL-001 | ARCH-UI-001, DES-UI-002 | `test/system/ui.spec.ts` |
| SPEC-EXT-001 | MCPサーバーの登録 | REQ-ASK-001, REQ-SEC-001 | ARCH-CYCLE-001, ARCH-LAYER-005, ARCH-EFFECT-003, DES-HTTP-001 | `test/system/extension.test.ts`, `test/system/startup.test.ts` |
| SPEC-EXT-002 | 待機の表示 | REQ-WAIT-001 | ARCH-EFFECT-001, ARCH-PORT-001, DES-PEND-001 | `test/system/extension.test.ts` |
| SPEC-EXT-003 | web版の下書き | REQ-RES-002 | ARCH-LAYER-004, DES-CHAT-001 | `test/system/extension.test.ts` |
| SPEC-EXT-004 | web版 | REQ-WEB-001, REQ-CANCEL-001 | ARCH-LAYER-002, ARCH-LAYER-004, ARCH-LAYER-005, ARCH-UI-001, DES-UI-002, DES-HOST-001, DES-TOOLS-002 | `test/system/extension.test.ts` |
| SPEC-EXT-006 | MCPを使わない環境 | REQ-WEB-001 | - | `test/system/extension.test.ts` |
| SPEC-EXT-005 | 起動・サイズ・検査の予算 | REQ-PERF-001 | ARCH-LAYER-002, ARCH-LAYER-006, ARCH-DEPS-001, DES-TOOLS-001 | `test/system/extension.test.ts`, `test/system/process.test.ts` |
| SPEC-REL-001 | 配布前の検査と公開 | REQ-DIST-001 | ARCH-REL-001, DES-REL-001 | `test/system/release-check.test.ts`, `test/system/release-workflow.test.ts` |

## アーキテクチャ設計

| ID | 名前 | 派生元 | 派生先 | 検証 |
| --- | --- | --- | --- | --- |
| ARCH-CYCLE-001 | 循環参照がない | SPEC-MCP-001, SPEC-EXT-001 | - | `test/integration/architecture.test.ts` |
| ARCH-LAYER-001 | 中核は純粋 | SPEC-FORM-001, SPEC-FORM-002, SPEC-EXPR-001, SPEC-MCP-006 | DES-SPEC-001, DES-FORM-004 | `test/integration/architecture.test.ts` |
| ARCH-LAYER-002 | 画面はブラウザだけで動く | SPEC-UI-001, SPEC-EXT-004, SPEC-EXT-005 | - | `test/integration/architecture.test.ts` |
| ARCH-LAYER-003 | MCPサーバーはVS Codeを知らない | SPEC-MCP-001 | - | `test/integration/architecture.test.ts` |
| ARCH-LAYER-004 | web版の入口はNode.jsを使わない | SPEC-EXT-004, SPEC-EXT-003 | DES-CHAT-001 | `test/integration/architecture.test.ts` |
| ARCH-LAYER-005 | 入口は互いに依存しない | SPEC-EXT-001, SPEC-EXT-004 | - | `test/integration/architecture.test.ts` |
| ARCH-LAYER-006 | 画面が使う中核はEffectを使わない | SPEC-EXT-005, SPEC-UI-002, SPEC-EXPR-001, SPEC-MCP-003, SPEC-UI-005 | DES-EXPR-002, DES-FORM-002, DES-FORM-003 | `test/integration/architecture.test.ts` |
| ARCH-EFFECT-001 | サービスの定義は実装を知らない | SPEC-EXT-002, SPEC-MCP-008 | - | `test/integration/architecture.test.ts` |
| ARCH-EFFECT-002 | ツールの処理は通信手段を知らない | SPEC-MCP-003, SPEC-MCP-005, SPEC-MCP-009 | - | `test/integration/architecture.test.ts` |
| ARCH-EFFECT-003 | 層を組み立てるのは入口だけ | SPEC-EXT-001 | DES-HTTP-001 | `test/integration/architecture.test.ts` |
| ARCH-DEPS-001 | 配布物の依存は限られる | SPEC-EXT-005 | DES-TOOLS-001 | `test/integration/architecture.test.ts` |
| ARCH-PORT-001 | MCPサーバーへの差し込み口 | SPEC-EXT-002, SPEC-MCP-008, SPEC-UI-005 | DES-CHAT-001 | `test/integration/ports.test.ts` |
| ARCH-UI-001 | 画面の通信は1種類 | SPEC-EXT-004, SPEC-UI-001, SPEC-UI-005, SPEC-UI-006, SPEC-UI-010 | DES-UI-001, DES-UI-002, DES-HOST-001, DES-TOOLS-002 | `test/system/ui.spec.ts` |
| ARCH-REL-001 | 検出と公開の権限を分ける | SPEC-REL-001 | DES-REL-001 | `test/system/release-workflow.test.ts` |

## 詳細設計

| ID | 名前 | 派生元 | 派生先 | 検証 |
| --- | --- | --- | --- | --- |
| DES-SPEC-001 | 設計図の読み取り | SPEC-FORM-001, SPEC-FORM-002, SPEC-MCP-004, ARCH-LAYER-001 | - | `test/unit/form-edge-cases.test.ts`, `test/unit/form.test.ts` |
| DES-SPEC-002 | 正規化と鍵 | SPEC-MCP-006 | - | `test/unit/form.test.ts` |
| DES-EXPR-001 | 字句と構文 | SPEC-EXPR-001, SPEC-FORM-002 | - | `test/unit/expression.test.ts` |
| DES-EXPR-002 | 評価 | SPEC-EXPR-001, ARCH-LAYER-006 | - | `test/unit/expression.test.ts` |
| DES-FORM-001 | 初期値 | SPEC-UI-001 | - | `test/unit/form.test.ts` |
| DES-FORM-002 | 計算結果の順序 | SPEC-FORM-001, SPEC-UI-002, SPEC-EXPR-001, ARCH-LAYER-006 | - | `test/unit/form-edge-cases.test.ts`, `test/unit/form.test.ts` |
| DES-FORM-003 | 差分 | SPEC-MCP-003, SPEC-UI-001, SPEC-UI-005, ARCH-LAYER-006 | - | `test/unit/form-edge-cases.test.ts`, `test/unit/form.test.ts` |
| DES-FORM-004 | 値の検査 | SPEC-MCP-005, ARCH-LAYER-001 | - | `test/unit/form-edge-cases.test.ts`, `test/unit/form.test.ts` |
| DES-FORM-005 | 送り直しの文章 | SPEC-MCP-008 | - | `test/unit/form.test.ts` |
| DES-PEND-001 | 待機の台帳 | SPEC-MCP-003, SPEC-MCP-005, SPEC-MCP-007, SPEC-EXT-002 | - | `test/unit/pending.test.ts` |
| DES-UI-001 | 中断状態の確認 | SPEC-UI-006, ARCH-UI-001 | - | `test/unit/status.test.ts` |
| DES-UI-002 | メッセージの送り主の検査 | SPEC-UI-010, SPEC-EXT-004, ARCH-UI-001 | - | `test/unit/bridge.test.ts`, `test/unit/panel-bridge.test.ts` |
| DES-HOST-001 | 初期化前の中断 | SPEC-EXT-004, SPEC-UI-006, ARCH-UI-001 | - | `test/unit/app-host.test.ts` |
| DES-HTTP-001 | 待ち受けの失敗 | SPEC-EXT-001, SPEC-MCP-009, ARCH-EFFECT-003 | - | `test/unit/http.test.ts` |
| DES-CHAT-001 | 投稿ごとの添付 | SPEC-EXT-003, SPEC-MCP-008, ARCH-LAYER-004, ARCH-PORT-001 | - | `test/unit/attachments.test.ts`, `test/unit/chat.test.ts`, `test/unit/form-edge-cases.test.ts` |
| DES-TOOLS-001 | 時間の予算による終了 | SPEC-EXT-005, ARCH-DEPS-001 | - | `test/unit/process.test.ts` |
| DES-TOOLS-002 | web受け入れテストの完了 | SPEC-EXT-004, ARCH-UI-001 | - | `test/unit/web-completion.test.ts` |
| DES-REL-001 | 版数と変更履歴の検査 | SPEC-REL-001, ARCH-REL-001 | - | `test/unit/release-check.test.ts`, `test/unit/release-workflow.test.ts` |
