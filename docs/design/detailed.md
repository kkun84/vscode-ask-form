# 詳細設計

層の中の処理の作りを定めます。各項目は単体テスト(`test/unit`)で検証します。

## 設計図

### DES-SPEC-001 設計図の読み取り

設計図はEffect Schemaで読み取る(`src/core/validate.ts`)。未知のキーは捨てる。画面はEffectを使わないため、読み取りと検査は拡張機能とMCPサーバーの側だけで行う。読み取りの誤りと意味的な検査の誤りは、どちらも「どこが」「なぜ」を含む文の一覧にまとめる。

- 項目と計算結果で共通の`id`のSchemaから、予約語と完全に一致する`true`と`false`を拒否する。`trueValue`や`True`など異なる名前は受け付ける。
- 複数選択の`default`は、配列の長さと値の集合の大きさを比べ、重複があれば項目の`id`と`default`の誤りを返す。値を黙って削らず、空の配列と重複のない配列を受け付ける。

派生元: SPEC-FORM-001, SPEC-FORM-002, SPEC-MCP-004, ARCH-LAYER-001

### DES-SPEC-002 正規化と鍵

受け取った引数を、読み取る前の形のまま、キーを辞書順に並べ値が`undefined`のキーを除いたJSONに直す。その文字列から、FNV-1aを2つの異なる初期値で計算して16桁の16進数を作り、鍵とする。

派生元: SPEC-MCP-006

## 計算式

### DES-EXPR-001 字句と構文

計算式を字句に分け、優先順位の低い順に「条件」「論理和」「論理積」「等価」「比較」「加減」「乗除」「単項」「関数呼び出しと値」として再帰下降で解析する。誤りは位置つきで返す。

派生元: SPEC-EXPR-001, SPEC-FORM-002

### DES-EXPR-002 評価

解析結果を値の表に照らして評価する。数値でない値への算術、0での割り算、有限でない結果は評価できないものとして扱う。

- 数値リテラルも評価時に有限かを検査し、`1e999`のように桁あふれした値は未定義にする。比較や後続の式に無限大を渡さず、有限な数値と短絡評価はそのまま扱う。

派生元: SPEC-EXPR-001, ARCH-LAYER-006

## 値

### DES-FORM-001 初期値

各項目の初期値は`default`とし、`default`のない文字列項目は空文字列、`default`のない数値項目は`min`とする。

派生元: SPEC-UI-001

### DES-FORM-002 計算結果の順序

計算結果は設計図に書かれた順に評価し、評価済みの結果を後の式から参照できるようにする。

- 各結果の`id`と値の組から`Object.fromEntries`で結果の表を作り、`__proto__`も列挙可能な自身のキーとして保持する。数値と評価不能の`null`の両方を表示と回答のJSONに残す。
- 桁あふれのリテラルを含め、評価不能の値は結果の表では`null`にし、後続の式に渡す値の表では未定義にする。

派生元: SPEC-FORM-001, SPEC-UI-002, SPEC-EXPR-001, ARCH-LAYER-006

### DES-FORM-003 差分

2組の値を項目ごとに比べ、異なる項目を設計図の順で返す。複数選択は並び順を無視して比べる。

- 複数選択は入力を変更せずに並べ替え、長さと各要素の一致を調べる。区切り文字でつながず、NUL文字を含む値でも衝突しないようにする。この差分を`changedByUser`と画面の変更表示、送り直しの判定に使う。

- 送り直しの基準はツールの結果として渡した回答に固定し、下書きを置いても更新しない。画面はこの基準とは別に要約用の値を保持し、下書き後の要約と再編集のキャンセルでは最後に置いた値を使う。

派生元: SPEC-MCP-003, SPEC-UI-001, SPEC-UI-005, ARCH-LAYER-006

### DES-FORM-004 値の検査

画面から届いた値を、項目の種類、範囲、選択肢に照らして検査する。

- 複数選択は、すべての要素が選択肢の文字列で、配列の長さと値の集合の大きさが等しい場合だけ受け付ける。重複があれば項目の`id`を含む誤りを返し、計算と回答に渡さない。

派生元: SPEC-MCP-005, ARCH-LAYER-001

### DES-FORM-005 送り直しの文章

差分を「項目名を新しい値」の形で並べ、「「フォーム名」で…に変えたので、反映して続けてください。」の文章を作る。英語のロケールでは同じ内容を英語で作る。値は選択肢の表示名、`prefix`と`suffix`、オンとオフで表す。

派生元: SPEC-MCP-008

### DES-FORM-006 選択肢ごとの項目

- `allFields`は、最上位の項目のそれぞれの後に、その選択肢の`fields`の項目を選択肢の順に並べる。`id`の重複、項目の検査、計算式が参照できる`id`、初期値はこの並びで扱う。
- `activeFields`は、最上位の項目と、単一選択で選ばれている選択肢の`fields`の項目を返す。差分、計算式に渡す値の表、要約、値の検査はこの並びで扱う。値の検査は、届いた値の選択項目から有効な項目を決め、それ以外のキーを捨てる。
- `answerValues`は値の表を`activeFields`の項目に絞る。画面は全項目の値を持ち続け、回答と送り直しのときだけ絞る。AIに任せたときの値も初期値を絞って返す。
- 差分は`after`の有効な項目について比べる。`before`にない項目は変更とする。`changedByUser`は全項目の初期値と比べるため、切り替えただけの項目を含めない。送り直しは絞った回答と比べるため、現れた項目を含める。
- 入れ子が2段以上ある設計図は、読み取りで捨てられる前のJSONを調べて拒否する。Schemaの型を再帰させず、JSON Schemaを平らに保つため。

派生元: SPEC-FORM-001, SPEC-FORM-002, SPEC-MCP-003, SPEC-UI-011

## 待機

### DES-PEND-001 待機の台帳

待機中の呼び出しを鍵ごとの先入れ先出しの列で持つ。呼び出しが取り消されたら列から外す。待機の総数が変わったときだけ`WaitingIndicator`へ知らせる。

待機の登録と終了処理はEffectの`acquireUseRelease`で組にする。終了時に、回答が渡されたか中断されたかを記録する。終了状態は直近128個の鍵だけを保持し、同じ鍵で待機中の呼び出しがあれば終了状態より優先する。記録のない鍵は`unknown`とする。

- 回答時は`uninterruptibleMask`の中で台帳から対象を外し、`Deferred`を完了する。待機数の通知はその後に`restore`で中断可能に戻して行い、通知が待ち続けても質問への回答を失わない。

派生元: SPEC-MCP-003, SPEC-MCP-005, SPEC-MCP-007, SPEC-EXT-002

## 画面の中断

### DES-UI-001 中断状態の確認

回答待ちの画面は、MCP Appsの`tools/call`で`form_status`を呼び、返答から1秒後に次の確認を行う。確認を重ねて送らず、通信の失敗や`unknown`を中断と扱わない。`cancelled`を受け取ると中断を一度だけ知らせる。回答待ちでなくなるとタイマーを止め、遅れて届いた返答を無視する。

[MCP Appsの仕様](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)はホストに`ui/notifications/tool-cancelled`の送信を求めるが、[VS Code 1.142の画面ホスト](https://github.com/microsoft/vscode/blob/1.142.0/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/toolInvocationParts/chatMcpAppModel.ts)はMCP出力がある結果だけを転送し、中断を通知しない。[MCPへの要求処理](https://github.com/microsoft/vscode/blob/1.142.0/src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts)は`notifications/cancelled`を送るため、画面はサーバーの終了状態でも中断を確認する。

派生元: SPEC-UI-006, ARCH-UI-001

### DES-UI-002 メッセージの送り主の検査

- `src/ui/bridge.ts`は通知と返答の両方について`event.source`が接続先と同一であることを確かめてから処理する。接続先の`location.origin`を読める場合はそのoriginを使い、読めない場合は検証済みの送り主の最初のJSON-RPCからoriginを固定する。送信先にもそのoriginを使い、未確定か不透明な`null`の場合だけ`*`とする。
- web版はVS Codeが`window.parent`を置き換えるため、専用の橋渡しをパネルに埋め込む。同じoriginで、子フレームの一覧にこの画面を持つ実際の親からのイベントだけを接続先の送り主に変換する。画面自身、別のフレーム、送り主のないイベントは渡さない。リスナーの削除にも同じラッパーを使う。

派生元: SPEC-UI-010, SPEC-EXT-004, ARCH-UI-001

### DES-HOST-001 初期化前の中断

- `createAppHost`は中断状態を保持し、初期化に応答して設計図を送った直後に中断を再通知する。初期化が繰り返されても同様に通知し、中断済みのフォームへの回答は拒否する。

派生元: SPEC-EXT-004, SPEC-UI-006, ARCH-UI-001

## HTTPの起動

### DES-HTTP-001 待ち受けの失敗

- `listen`より先に`error`の受け口を登録し、非同期のエラーと同期の例外を原因つきの`FormsListenFailed`としてEffectの失敗にする。成功と失敗のどちらでも起動用の`error`と`listening`の受け口を外し、サーバー自身の受け口は残す。失敗時もEffectのスコープがWebハンドラーを解放する。

派生元: SPEC-EXT-001, SPEC-MCP-009, ARCH-EFFECT-003

## 投稿

### DES-CHAT-001 投稿ごとの添付

- 投稿ごとにWeb Cryptoの`randomUUID()`でディレクトリ名を作り、`<storage>/answers/<uuid>/<slug>.json`にJSONを保存する。`slug`は題名を整形して40コードポイントまでに切り詰め、空なら`form`とする。添付の表示名は`<slug>.json`とし、UUIDを含めない。
- 同じ題名、同じ整形結果、空になる題名でも投稿ごとのディレクトリで以前の添付を再利用しない。`src/extension/shared/chat.ts`の共通処理でディレクトリ作成と書込の完了を待つ。web版は保存したファイルを指定して入力欄に下書きとして入れる(`isPartialQuery: true`)。
- デスクトップ版は`AttachmentStore`の実装から共通保存処理を使い、`context.globalStorageUri/answers/<uuid>/<slug>.json`に保存する。読込もVS CodeのファイルAPIを使い、保存先の再作成後も同じ内容を返す。件数による削除は行わず、ファイル操作の失敗は`AttachmentStoreFailed`に変換する。
- 題名の整形後にコードポイントの配列へ変えて40個までを結合する。39個の`a`に続く`𠮷`も分断せず、`encodeURIComponent`が成功する。

派生元: SPEC-EXT-003, SPEC-MCP-008, ARCH-LAYER-004, ARCH-PORT-001

## 検査の実行

### DES-TOOLS-001 時間の予算による終了

- `scripts/process.ts`はPOSIXでは子を新しいプロセスグループで起動し、予算超過時はグループに`SIGTERM`を送り、1秒後に`SIGKILL`を送る。受け入れテストの子はそのグループを引き継ぐ。グループが既に消えている場合の`ESRCH`は無視する。
- Windowsでは`taskkill /T`でツリーを対象とし、強制終了では`/F`も使う。
- 直下の子が先に終了しても猶予のタイマーを残し、強制終了の処理を終えてから失敗を返す。通常終了と起動失敗ではタイマーとシグナルの受け口を片付ける。実行スクリプト自身の`SIGINT`と`SIGTERM`も同じ終了処理につなぐ。

派生元: SPEC-EXT-005, ARCH-DEPS-001

### DES-TOOLS-002 web受け入れテストの完了

- `codeAutomationExit`の終了通知とブラウザ側の回答処理を別のPromiseとして待つ。終了コード0だけでは完了せず、入力操作と要約の確認も成功してからブラウザを閉じる。終了コードが非0か回答処理が失敗した場合は、他方の完了を待たず失敗とする。

派生元: SPEC-EXT-004, ARCH-UI-001

## リリース

### DES-REL-001 版数と変更履歴の検査

- `scripts/release.ts`の純粋な関数で版数、タグ、対象版の箇条書きを検査し、minorの奇偶と次の第2階層見出しまでの本文を返す。CRLFも受け付け、他の版の本文は混ぜない。
- `scripts/release-check.ts`がNode.jsのファイル操作と環境変数を扱い、検査結果をワークフローへ渡す。パッケージ用スクリプト末尾のvsceに`--pre-release`を渡し、GitHub Releasesには`--prerelease`、MarketplaceとOpen VSXには`--pre-release`を渡す。

- detectはpackage.jsonからversionと`v<version>`のtagを出力し、`git ls-remote --exit-code --tags origin "refs/tags/$TAG"`の終了コード0ならrelease=false、2ならrelease=trueを出力する。それ以外は失敗とする。releaseはdetectのtagを検査CLIの第1引数と公開に使い、`gh release create`の`--target "$GITHUB_SHA"`でタグを作る。

派生元: SPEC-REL-001, ARCH-REL-001
