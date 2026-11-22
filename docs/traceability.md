# トレーサビリティ

`node scripts/traceability.ts --write`で生成します。手で編集しません。

## 要求仕様

| ID | 名前 | 派生元 | 派生先 | 検証 |
| --- | --- | --- | --- | --- |
| REQ-ASK-001 | フォームで質問できる | - | SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-001, SPEC-TOOL-004, SPEC-EXT-004 | `test/acceptance/chat.spec.ts`, `test/acceptance/harness.spec.ts`, MAT-ASK-001 |
| REQ-ASK-002 | 推奨と理由が見える | - | SPEC-FORM-001, SPEC-UI-001 | `test/acceptance/chat.spec.ts`, MAT-ASK-001 |
| REQ-ASK-003 | 結果がその場で変わる | - | SPEC-FORM-001, SPEC-EXPR-001, SPEC-UI-002 | MAT-ASK-001 |
| REQ-ASK-004 | 選んだ選択肢に応じて続きを聞ける | - | SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-003, SPEC-UI-011 | MAT-ASK-002 |
| REQ-ASK-005 | 順位を聞ける | - | SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-005, SPEC-UI-015 | MAT-ASK-003 |
| REQ-ASK-006 | 多くの候補から選べる | - | SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-005, SPEC-UI-016 | MAT-ASK-004 |
| REQ-ASK-007 | 自由な値を複数書いてもらえる | - | SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-005, SPEC-UI-017 | MAT-ASK-005 |
| REQ-ASK-008 | 数値の範囲を聞ける | - | SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-005, SPEC-UI-018 | MAT-ASK-006 |
| REQ-ASK-009 | 日付と時刻を聞ける | - | SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-005, SPEC-UI-019 | MAT-ASK-007 |
| REQ-ASK-010 | 階層のある候補から選ばせられる | - | SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-005, SPEC-UI-020 | MAT-ASK-008 |
| REQ-ANS-001 | 1回の操作で回答が届く | - | SPEC-TOOL-001, SPEC-TOOL-003, SPEC-TOOL-005, SPEC-TOOL-006, SPEC-UI-003 | `test/acceptance/chat.spec.ts`, MAT-ANS-001 |
| REQ-ANS-003 | キャンセルしてチャットで答えられる | - | SPEC-TOOL-003, SPEC-UI-003 | `test/acceptance/chat.spec.ts`, MAT-ANS-002, MAT-PANEL-001 |
| REQ-ANS-005 | 質問ごとに、値を答えずにコメントだけで返せる | - | SPEC-TOOL-003, SPEC-TOOL-005, SPEC-UI-012 | `test/acceptance/chat.spec.ts`, MAT-ANS-002 |
| REQ-ANS-006 | 補足を添えられる | - | SPEC-TOOL-003, SPEC-TOOL-005, SPEC-UI-013 | `test/acceptance/chat.spec.ts`, MAT-ANS-002 |
| REQ-ANS-007 | 質問ごとにコメントを添えられる | - | SPEC-TOOL-005, SPEC-TOOL-010, SPEC-UI-014 | `test/acceptance/chat.spec.ts`, MAT-ANS-002 |
| REQ-ANS-004 | キーボードだけで回答できる | - | SPEC-UI-003, SPEC-UI-008 | MAT-ANS-001 |
| REQ-RES-001 | 回答後にフォームが残らない | - | SPEC-EXT-004 | `test/acceptance/chat.spec.ts`, MAT-RES-001 |
| REQ-CANCEL-001 | 止めた質問に回答が残らない | - | SPEC-TOOL-005, SPEC-TOOL-007, SPEC-UI-006, SPEC-EXT-004 | `test/acceptance/chat.spec.ts`, `test/acceptance/tool.spec.ts`, MAT-CANCEL-001 |
| REQ-WAIT-001 | 回答待ちが分かる | - | SPEC-EXT-002 | `test/acceptance/chat.spec.ts`, `test/acceptance/tool.spec.ts`, MAT-CANCEL-001, MAT-PANEL-001 |
| REQ-WAIT-002 | 利用者が不在の設定では待たない | - | SPEC-TOOL-003, SPEC-EXT-007 | `test/acceptance/chat.spec.ts`, MAT-WAIT-001 |
| REQ-WEB-001 | web版でも回答できる | - | SPEC-EXT-004 | `test/acceptance/tool.spec.ts`, MAT-WEB-001 |
| REQ-ENV-002 | Codexのハーネスでも回答できる | - | SPEC-TOOL-001 | `test/acceptance/harness.spec.ts`, MAT-ENV-002 |
| REQ-ENV-003 | Agentsウィンドウでも回答できる | - | SPEC-TOOL-001 | `test/acceptance/harness.spec.ts`, MAT-ENV-003 |
| REQ-PERF-001 | 軽い | - | SPEC-EXT-005 | `test/acceptance/startup.spec.ts`, MAT-PERF-001 |
| REQ-SEC-001 | 回答を偽装されない | - | SPEC-UI-010 | MAT-SEC-001 |
| REQ-LOOK-001 | VS Codeに馴染む | - | SPEC-UI-007, SPEC-UI-009 | MAT-LOOK-001 |
| REQ-A11Y-001 | 支援技術で使える | - | SPEC-UI-008 | MAT-LOOK-001 |
| REQ-DIST-001 | リリースを配布する | - | SPEC-REL-001, SPEC-REL-002, SPEC-REL-003 | MAT-DIST-001 |

## システム仕様

| ID | 名前 | 派生元 | 派生先 | 検証 |
| --- | --- | --- | --- | --- |
| SPEC-FORM-001 | 設計図の形 | REQ-ASK-001, REQ-ASK-002, REQ-ASK-003, REQ-ASK-004, REQ-ASK-005, REQ-ASK-006, REQ-ASK-007, REQ-ASK-008, REQ-ASK-009, REQ-ASK-010 | ARCH-LAYER-001, DES-SPEC-001, DES-FORM-002, DES-FORM-006 | `test/system/form.test.ts` |
| SPEC-FORM-002 | 設計図の意味的な検査 | REQ-ASK-001, REQ-ASK-004, REQ-ASK-005, REQ-ASK-006, REQ-ASK-007, REQ-ASK-008, REQ-ASK-009, REQ-ASK-010 | ARCH-LAYER-001, DES-SPEC-001, DES-EXPR-001, DES-FORM-006 | `test/system/form.test.ts` |
| SPEC-EXPR-001 | 計算式 | REQ-ASK-003 | ARCH-LAYER-001, ARCH-LAYER-006, DES-EXPR-001, DES-EXPR-002, DES-FORM-002 | `test/system/form.test.ts` |
| SPEC-TOOL-001 | 質問のツール | REQ-ASK-001, REQ-ANS-001, REQ-ENV-002, REQ-ENV-003 | ARCH-CYCLE-001 | `test/system/extension.test.ts` |
| SPEC-TOOL-003 | 回答を待つ | REQ-ANS-001, REQ-ANS-003, REQ-ANS-005, REQ-ANS-006, REQ-ASK-004, REQ-WAIT-002 | ARCH-LAYER-006, DES-FORM-003, DES-FORM-006, DES-FORM-007, DES-FORM-008, DES-FORM-009 | `test/system/form.test.ts`, `test/system/tool.test.ts` |
| SPEC-TOOL-004 | 設計図の誤り | REQ-ASK-001 | DES-SPEC-001 | `test/system/tool.test.ts` |
| SPEC-TOOL-005 | 画面からの回答 | REQ-ANS-001, REQ-ANS-005, REQ-ANS-006, REQ-ANS-007, REQ-CANCEL-001, REQ-ASK-005, REQ-ASK-006, REQ-ASK-007, REQ-ASK-008, REQ-ASK-009, REQ-ASK-010 | DES-FORM-004, DES-FORM-007, DES-FORM-008, DES-FORM-009, DES-HOST-001 | `test/system/form.test.ts`, `test/system/tool.test.ts` |
| SPEC-TOOL-006 | フォームの鍵 | REQ-ANS-001 | ARCH-LAYER-001, DES-SPEC-002 | `test/system/tool.test.ts` |
| SPEC-TOOL-007 | 中断 | REQ-CANCEL-001 | DES-HOST-001 | `test/system/tool.test.ts` |
| SPEC-TOOL-010 | 画面の設定 | REQ-ANS-007 | DES-FORM-009 | `test/system/extension.test.ts` |
| SPEC-UI-001 | 初期表示 | REQ-ASK-002 | ARCH-LAYER-002, ARCH-UI-001, DES-FORM-001, DES-FORM-003 | `test/system/ui.spec.ts` |
| SPEC-UI-002 | 計算結果 | REQ-ASK-003 | ARCH-LAYER-006, DES-FORM-002 | `test/system/ui.spec.ts` |
| SPEC-UI-003 | 回答の操作 | REQ-ANS-001, REQ-ANS-003, REQ-ANS-004 | - | `test/system/ui.spec.ts` |
| SPEC-UI-006 | 受け付けられない回答 | REQ-CANCEL-001 | ARCH-UI-001, DES-HOST-001 | `test/system/ui.spec.ts` |
| SPEC-UI-007 | テーマ | REQ-LOOK-001 | - | `test/system/ui.spec.ts` |
| SPEC-UI-008 | アクセシビリティ | REQ-A11Y-001, REQ-ANS-004 | - | `test/system/ui.spec.ts` |
| SPEC-UI-009 | 表示の言語 | REQ-LOOK-001 | - | `test/system/ui.spec.ts` |
| SPEC-UI-011 | 条件付きの項目 | REQ-ASK-004 | DES-FORM-006 | `test/system/ui.spec.ts` |
| SPEC-UI-012 | 値のない回答 | REQ-ANS-005 | DES-FORM-007 | `test/system/ui.spec.ts` |
| SPEC-UI-013 | 補足 | REQ-ANS-006 | - | `test/system/ui.spec.ts` |
| SPEC-UI-014 | 項目ごとのコメント | REQ-ANS-007 | DES-FORM-009 | `test/system/ui.spec.ts` |
| SPEC-UI-015 | 並べ替え | REQ-ASK-005 | - | `test/system/ui.spec.ts` |
| SPEC-UI-016 | 候補の絞り込み | REQ-ASK-006 | - | `test/system/ui.spec.ts` |
| SPEC-UI-017 | 文字のリスト | REQ-ASK-007 | - | `test/system/ui.spec.ts` |
| SPEC-UI-018 | 数値の範囲 | REQ-ASK-008 | - | `test/system/ui.spec.ts` |
| SPEC-UI-019 | 日付と時刻 | REQ-ASK-009 | - | `test/system/ui.spec.ts` |
| SPEC-UI-020 | 木から選ぶ | REQ-ASK-010 | - | `test/system/ui.spec.ts` |
| SPEC-UI-010 | 画面への通知の送り主 | REQ-SEC-001 | ARCH-UI-001, DES-UI-002 | `test/system/ui.spec.ts` |
| SPEC-EXT-002 | 待機の表示 | REQ-WAIT-001 | - | `test/system/extension.test.ts` |
| SPEC-EXT-004 | パネルのフォーム | REQ-ASK-001, REQ-WEB-001, REQ-CANCEL-001, REQ-RES-001 | ARCH-LAYER-002, ARCH-UI-001, DES-UI-002, DES-HOST-001 | `test/system/extension.test.ts` |
| SPEC-EXT-007 | 利用者が不在の設定 | REQ-WAIT-002 | - | `test/system/extension.test.ts` |
| SPEC-EXT-005 | 起動・サイズ・検査の予算 | REQ-PERF-001 | ARCH-LAYER-002, ARCH-LAYER-006, ARCH-DEPS-001, DES-TOOLS-001, DES-TOOLS-003 | `test/system/extension.test.ts`, `test/system/process.test.ts` |
| SPEC-REL-001 | 配布前の検査と公開 | REQ-DIST-001 | ARCH-REL-001, DES-REL-001 | `test/system/release-check.test.ts`, `test/system/release-prepare.test.ts`, `test/system/release-workflow.test.ts` |
| SPEC-REL-002 | 変更履歴の項目の検査 | REQ-DIST-001 | DES-REL-002 | `test/system/changelog-check.test.ts` |
| SPEC-REL-003 | 画像と紹介動画の撮り直しの検査 | REQ-DIST-001 | DES-REL-003 | `test/system/media-check.test.ts` |

## アーキテクチャ設計

| ID | 名前 | 派生元 | 派生先 | 検証 |
| --- | --- | --- | --- | --- |
| ARCH-CYCLE-001 | 循環参照がない | SPEC-TOOL-001 | - | `test/architecture/architecture.test.ts` |
| ARCH-LAYER-001 | 中核は純粋 | SPEC-FORM-001, SPEC-FORM-002, SPEC-EXPR-001, SPEC-TOOL-006 | DES-SPEC-001, DES-FORM-004, DES-FORM-008 | `test/architecture/architecture.test.ts` |
| ARCH-LAYER-002 | 画面はブラウザだけで動く | SPEC-UI-001, SPEC-EXT-004, SPEC-EXT-005 | - | `test/architecture/architecture.test.ts` |
| ARCH-LAYER-006 | 画面が使う中核はEffectを使わない | SPEC-EXT-005, SPEC-UI-002, SPEC-EXPR-001, SPEC-TOOL-003 | DES-EXPR-002, DES-FORM-002, DES-FORM-003, DES-FORM-007 | `test/architecture/architecture.test.ts` |
| ARCH-DEPS-001 | 配布物の依存は限られる | SPEC-EXT-005 | DES-TOOLS-001, DES-TOOLS-003 | `test/architecture/architecture.test.ts` |
| ARCH-UI-001 | 画面の通信は1種類 | SPEC-EXT-004, SPEC-UI-001, SPEC-UI-006, SPEC-UI-010 | DES-UI-002, DES-HOST-001 | `test/system/ui.spec.ts` |
| ARCH-REL-001 | 検出と公開の権限を分ける | SPEC-REL-001 | DES-REL-001 | `test/system/release-workflow.test.ts` |

## 詳細設計

| ID | 名前 | 派生元 | 派生先 | 検証 |
| --- | --- | --- | --- | --- |
| DES-SPEC-001 | 設計図の読み取り | SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-004, ARCH-LAYER-001 | - | `test/unit/form-edge-cases.test.ts`, `test/unit/form.test.ts` |
| DES-SPEC-002 | 正規化と鍵 | SPEC-TOOL-006 | - | `test/unit/form.test.ts` |
| DES-EXPR-001 | 字句と構文 | SPEC-EXPR-001, SPEC-FORM-002 | - | `test/unit/expression.test.ts` |
| DES-EXPR-002 | 評価 | SPEC-EXPR-001, ARCH-LAYER-006 | - | `test/unit/expression.test.ts` |
| DES-FORM-001 | 初期値 | SPEC-UI-001 | - | `test/unit/form.test.ts` |
| DES-FORM-002 | 計算結果の順序 | SPEC-FORM-001, SPEC-UI-002, SPEC-EXPR-001, ARCH-LAYER-006 | - | `test/unit/form-edge-cases.test.ts`, `test/unit/form.test.ts` |
| DES-FORM-003 | 差分 | SPEC-TOOL-003, SPEC-UI-001, ARCH-LAYER-006 | - | `test/unit/form-edge-cases.test.ts`, `test/unit/form.test.ts` |
| DES-FORM-004 | 値の検査 | SPEC-TOOL-005, ARCH-LAYER-001 | - | `test/unit/form-edge-cases.test.ts`, `test/unit/form.test.ts` |
| DES-FORM-006 | 条件付きの項目 | SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-003, SPEC-UI-011 | - | `test/unit/branch.test.ts` |
| DES-FORM-007 | 値のない回答 | SPEC-TOOL-003, SPEC-TOOL-005, SPEC-UI-012, ARCH-LAYER-006 | - | `test/unit/form.test.ts` |
| DES-FORM-008 | 補足 | SPEC-TOOL-003, SPEC-TOOL-005, ARCH-LAYER-001 | - | `test/unit/form.test.ts` |
| DES-FORM-009 | 項目ごとのコメント | SPEC-TOOL-003, SPEC-TOOL-005, SPEC-TOOL-010, SPEC-UI-014 | - | `test/unit/form.test.ts` |
| DES-UI-002 | メッセージの送り主の検査 | SPEC-UI-010, SPEC-EXT-004, ARCH-UI-001 | - | `test/unit/bridge.test.ts`, `test/unit/panel-bridge.test.ts` |
| DES-HOST-001 | 回答の受け付けの状態 | SPEC-TOOL-005, SPEC-TOOL-007, SPEC-EXT-004, SPEC-UI-006, ARCH-UI-001 | - | `test/unit/app-host.test.ts` |
| DES-TOOLS-001 | 時間の予算による終了 | SPEC-EXT-005, ARCH-DEPS-001 | - | `test/unit/process.test.ts` |
| DES-TOOLS-003 | ミューテーションテストの結果の判定 | SPEC-EXT-005, ARCH-DEPS-001 | - | `test/unit/mutation-report.test.ts` |
| DES-REL-001 | 版数と変更履歴の検査 | SPEC-REL-001, ARCH-REL-001 | - | `test/unit/release-check.test.ts`, `test/unit/release-workflow.test.ts` |
| DES-REL-002 | 変更履歴の項目の検査 | SPEC-REL-002 | - | `test/unit/release-check.test.ts`, `test/unit/release-workflow.test.ts` |
| DES-REL-003 | 画像と紹介動画の撮り直しの検査 | SPEC-REL-003 | - | `test/unit/media-rules.test.ts` |
