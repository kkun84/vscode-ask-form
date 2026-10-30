# 詳細設計

層の中の処理の作りを定めます。各項目は単体テスト(`test/unit`)で検証します。

## 設計図

### DES-SPEC-001 設計図の読み取り

設計図はEffect Schemaで読み取る(`src/core/validate.ts`)。未知のキーは捨てる。画面はEffectを使わないため、読み取りと検査は拡張機能とMCPサーバーの側だけで行う。読み取りの誤りと意味的な検査の誤りは、どちらも「どこが」「なぜ」を含む文の一覧にまとめる。

派生元: SPEC-FORM-001, SPEC-FORM-002, SPEC-MCP-004

### DES-SPEC-002 正規化と鍵

受け取った引数を、読み取る前の形のまま、キーを辞書順に並べ値が`undefined`のキーを除いたJSONに直す。その文字列から、FNV-1aを2つの異なる初期値で計算して16桁の16進数を作り、鍵とする。

派生元: SPEC-MCP-006

## 計算式

### DES-EXPR-001 字句と構文

計算式を字句に分け、優先順位の低い順に「条件」「論理和」「論理積」「等価」「比較」「加減」「乗除」「単項」「関数呼び出しと値」として再帰下降で解析する。誤りは位置つきで返す。

派生元: SPEC-EXPR-001, SPEC-FORM-002

### DES-EXPR-002 評価

解析結果を値の表に照らして評価する。数値でない値への算術、0での割り算、有限でない結果は評価できないものとして扱う。

派生元: SPEC-EXPR-001

## 値

### DES-FORM-001 初期値

各項目の初期値は`default`とし、`default`のない文字列項目は空文字列、`default`のない数値項目は`min`とする。

派生元: SPEC-UI-001

### DES-FORM-002 計算結果の順序

計算結果は設計図に書かれた順に評価し、評価済みの結果を後の式から参照できるようにする。

派生元: SPEC-UI-002, SPEC-EXPR-001

### DES-FORM-003 差分

2組の値を項目ごとに比べ、異なる項目を設計図の順で返す。複数選択は並び順を無視して比べる。

派生元: SPEC-MCP-003, SPEC-UI-005

### DES-FORM-004 値の検査

画面から届いた値を、項目の種類、範囲、選択肢に照らして検査する。

派生元: SPEC-MCP-005

### DES-FORM-005 送り直しの文章

差分を「項目名を新しい値」の形で並べ、「「フォーム名」で…に変えたので、反映して続けてください。」の文章を作る。英語のロケールでは同じ内容を英語で作る。値は選択肢の表示名、`prefix`と`suffix`、オンとオフで表す。

派生元: SPEC-MCP-008

## 待機

### DES-PEND-001 待機の台帳

待機中の呼び出しを鍵ごとの先入れ先出しの列で持つ。呼び出しが取り消されたら列から外す。待機の総数が変わったときだけ`WaitingIndicator`へ知らせる。

待機の登録と終了処理はEffectの`acquireUseRelease`で組にする。終了時に、回答が渡されたか中断されたかを記録する。終了状態は直近128個の鍵だけを保持し、同じ鍵で待機中の呼び出しがあれば終了状態より優先する。記録のない鍵は`unknown`とする。

派生元: SPEC-MCP-003, SPEC-MCP-005, SPEC-MCP-007, SPEC-EXT-002

## 画面の中断

### DES-UI-001 中断状態の確認

回答待ちの画面は、MCP Appsの`tools/call`で`form_status`を呼び、返答から1秒後に次の確認を行う。確認を重ねて送らず、通信の失敗や`unknown`を中断と扱わない。`cancelled`を受け取ると中断を一度だけ知らせる。回答待ちでなくなるとタイマーを止め、遅れて届いた返答を無視する。

[MCP Appsの仕様](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)はホストに`ui/notifications/tool-cancelled`の送信を求めるが、[VS Code 1.142の画面ホスト](https://github.com/microsoft/vscode/blob/1.142.0/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/toolInvocationParts/chatMcpAppModel.ts)はMCP出力がある結果だけを転送し、中断を通知しない。[MCPへの要求処理](https://github.com/microsoft/vscode/blob/1.142.0/src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts)は`notifications/cancelled`を送るため、画面はサーバーの終了状態でも中断を確認する。

派生元: SPEC-UI-006, ARCH-UI-001
