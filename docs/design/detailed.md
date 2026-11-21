# 詳細設計

層の中の処理の作りを定めます。各項目は単体テスト(`test/unit`)で検証します。

## 設計図

### DES-SPEC-001 設計図の読み取り

設計図はEffect Schemaで読み取る(`src/core/validate.ts`)。未知のキーは捨てる。画面はEffectを使わないため、読み取りと検査は拡張機能の側だけで行う。読み取りの誤りと意味的な検査の誤りは、どちらも「どこが」「なぜ」を含む文の一覧にまとめる。

- 項目と計算結果で共通の`id`のSchemaから、予約語と完全に一致する`true`と`false`を拒否する。`trueValue`や`True`など異なる名前は受け付ける。
- `default`のない項目に`reason`か`reasonDetails`があれば、項目の`id`を含む誤りを返す。画面は推奨のない項目の理由を表示しないので、AIに`description`へ書き直させる。
- 複数選択の`default`は、配列の長さと値の集合の大きさを比べ、重複があれば項目の`id`と`default`の誤りを返す。値を黙って削らず、空の配列と重複のない配列を受け付ける。
- 表示する文章のSchemaは、目安の文字数を受け取る関数で作る(`src/core/spec.ts`)。この関数は、上限を目安の2倍にし、目安を`description`の末尾に足す。AIに示すJSON Schemaと読み取りには、同じSchemaを使う。`id`、選択肢の`value`、`default`、計算式、`prefix`と`suffix`はこの関数を通さず、上限を広げない。

派生元: SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-004, ARCH-LAYER-001

### DES-SPEC-002 正規化と鍵

受け取った引数を、読み取る前の形のまま、キーを辞書順に並べ値が`undefined`のキーを除いたJSONに直す。その文字列から、FNV-1aを2つの異なる初期値で計算して16桁の16進数を作り、鍵とする。

派生元: SPEC-TOOL-006

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

各項目の初期値は`default`とする。`default`のない文字列項目は空文字列、複数選択は空の配列とし、単一選択と数値の項目は未回答とする。先頭の選択肢や`min`を初期値にはしない。未回答の項目が残る間は送信できない。

派生元: SPEC-UI-001

### DES-FORM-002 計算結果の順序

計算結果は設計図に書かれた順に評価し、評価済みの結果を後の式から参照できるようにする。

- 各結果の`id`と値の組から`Object.fromEntries`で結果の表を作り、`__proto__`も列挙可能な自身のキーとして保持する。数値と評価不能の`null`の両方を表示と回答のJSONに残す。
- 桁あふれのリテラルを含め、評価不能の値は結果の表では`null`にし、後続の式に渡す値の表では未定義にする。

派生元: SPEC-FORM-001, SPEC-UI-002, SPEC-EXPR-001, ARCH-LAYER-006

### DES-FORM-003 差分

2組の値を項目ごとに比べ、異なる項目を設計図の順で返す。複数選択は並び順を無視して比べる。

- 複数選択は入力を変更せずに並べ替え、長さと各要素の一致を調べる。区切り文字でつながず、NUL文字を含む値でも衝突しないようにする。この差分を`changedByUser`と画面の変更表示に使う。

派生元: SPEC-TOOL-003, SPEC-UI-001, ARCH-LAYER-006

### DES-FORM-004 値の検査

画面から届いた値を、項目の種類、範囲、選択肢に照らして検査する。値のない項目の扱いは DES-FORM-007 に従う。

- 複数選択は、すべての要素が選択肢の文字列で、配列の長さと値の集合の大きさが等しい場合だけ受け付ける。重複があれば項目の`id`を含む誤りを返し、計算と回答に渡さない。

派生元: SPEC-TOOL-005, ARCH-LAYER-001

### DES-FORM-006 選択肢ごとの項目

- `allFields`は、最上位の項目のそれぞれの後に、その選択肢の`fields`の項目を選択肢の順に並べる。`id`の重複、項目の検査、計算式が参照できる`id`、初期値はこの並びで扱う。
- `activeFields`は、最上位の項目と、単一選択で選ばれている選択肢の`fields`の項目を返す。差分、計算式に渡す値の表、値の検査はこの並びで扱う。値の検査は、届いた値の選択項目から有効な項目を決め、それ以外のキーを捨てる。
- `answerValues`は値の表を`activeFields`の項目に絞る。画面は全項目の値を持ち続け、回答のときだけ絞る。
- 差分は`after`の有効な項目について比べる。`before`にない項目は変更とする。`changedByUser`は全項目の初期値と比べるため、切り替えただけの項目を含めない。
- 入れ子が2段以上ある設計図は、読み取りで捨てられる前のJSONを調べて拒否する。Schemaの型を再帰させず、JSON Schemaを平らに保つため。

派生元: SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-003, SPEC-UI-011

### DES-FORM-007 値のない回答

値のない回答は、回答の値の表に項目の値がないことで表す。`held`の一覧は値の表から導く(`src/core/form.ts`)。

- `answerValues`は、値のない項目を値の表から除く。空欄の文字列は値として残す。`heldFields`は、有効な項目のうち値の表にない項目の`id`を設計図の順に返す。親の選択項目に値がなければ、その選択肢の`fields`の項目は有効にならず、`heldFields`にも入らない。
- 画面は、単一選択の「選択を解除」と、数値の入力欄を空にする操作で、値の表からその項目を消す。
- 未回答は、有効な項目のうち、値もコメントもない項目とする。
- `checkAnswer`は、`held`の一覧が値のない有効な項目とちょうど一致しなければ誤りを返し、値のない項目にコメントがなければ誤りを返す。
- `outcomeFor`は、`held`の項目の設計図を`heldForm`に入れる。
- 差分は値の違いを数え、値と値なしの間の変更も含める。`changedByUser`は差分から値のない項目を除く。

派生元: SPEC-TOOL-003, SPEC-TOOL-005, SPEC-UI-012, ARCH-LAYER-006

### DES-FORM-008 補足

`checkAnswer`は、画面から届いた値、`held`の一覧、コメント、補足をまとめて検査し、すべての誤りを1つの一覧で返す(`src/core/validate.ts`)。パネルのホストは、この関数で回答を検査する。

- 補足は前後の空白を除く。除いた結果が空なら補足なしとして扱い、`outcomeFor`は結果に`note`のキーを入れない。
- 補足が文字列でないか、空白を除く前の長さが2000文字を超えていれば誤りとする。

派生元: SPEC-TOOL-003, SPEC-TOOL-005, ARCH-LAYER-001

### DES-FORM-009 項目ごとのコメント

コメントは、項目の`id`から文章への対応(`Comments`)で表し、値の表とは別に持つ。

- `commentsFor`は、有効な項目のコメントだけを残し、前後の空白を除き、空のコメントを捨てる。`outcomeFor`はこれを`comments`に入れ、空なら`comments`のキーを入れない。
- `checkAnswer`は、コメントが文字列でないか、空白を除く前の長さが500文字を超えるか、有効でない項目へのコメントなら誤りとする。
- `appendPreset`は、定型文を書きかけのコメントの後ろに足す。末尾が日本語の文字なら空白を挟まず、それ以外なら空白を挟む。
- `commentPresetsFrom`は、設定の値が配列でなければ`undefined`を返して既定の定型文に任せ、配列なら文字列だけを空白を除いて残し、空の文と500文字を超える文を捨て、8個までにする。拡張機能と画面の両方がこの関数で設定を読む。

派生元: SPEC-TOOL-003, SPEC-TOOL-005, SPEC-TOOL-010, SPEC-UI-014

## 画面とホストの通信

### DES-UI-002 メッセージの送り主の検査

- `src/ui/bridge.ts`は通知と返答の両方について`event.source`が接続先と同一であることを確かめてから処理する。接続先の`location.origin`を読める場合はそのoriginを使い、読めない場合は検証済みの送り主の最初のJSON-RPCからoriginを固定する。送信先にもそのoriginを使い、未確定か不透明な`null`の場合だけ`*`とする。
- web版はVS Codeが`window.parent`を置き換えるため、専用の橋渡しをパネルに埋め込む。同じoriginで、子フレームの一覧にこの画面を持つ実際の親からのイベントだけを接続先の送り主に変換する。画面自身、別のフレーム、送り主のないイベントは渡さない。リスナーの削除にも同じラッパーを使う。

派生元: SPEC-UI-010, SPEC-EXT-004, ARCH-UI-001

### DES-HOST-001 回答の受け付けの状態

- `createAppHost`は、待機中、回答済み、中断のいずれかの状態を持つ。`form_answer`は、待機中で鍵が一致するときだけ受け付ける。受け付けると回答済みにし、結果を一度だけ`onOutcome`で拡張機能に渡し、画面には受け付けたことだけを返す。それ以外は`expired`の誤りを返す。
- 拡張機能はパネルが閉じたら`cancel`で中断にする。中断は画面に通知しない。閉じたパネルには何も届かないためである。初期化には中断の後も設計図を送る。

派生元: SPEC-TOOL-005, SPEC-TOOL-007, SPEC-EXT-004, SPEC-UI-006, ARCH-UI-001

## 検査の実行

### DES-TOOLS-001 時間の予算による終了

- `scripts/process.ts`はPOSIXでは子を新しいプロセスグループで起動し、予算超過時はグループに`SIGTERM`を送り、1秒後に`SIGKILL`を送る。受け入れテストの子はそのグループを引き継ぐ。グループが既に消えている場合の`ESRCH`は無視する。
- Windowsでは`taskkill /T`でツリーを対象とし、強制終了では`/F`も使う。
- 直下の子が先に終了しても猶予のタイマーを残し、強制終了の処理を終えてから失敗を返す。通常終了と起動失敗ではタイマーとシグナルの受け口を片付ける。実行スクリプト自身の`SIGINT`と`SIGTERM`も同じ終了処理につなぐ。

派生元: SPEC-EXT-005, ARCH-DEPS-001

### DES-TOOLS-003 ミューテーションテストの結果の判定

- `scripts/mutation-report.ts`の純粋な関数で、mutatorのJSONの結果の`findings`を判定する。`detectionRegression`はGitHub Actionsの`::error`の注釈にし、ミュータントのファイルと開始行を`files`の`mutants`からidで引いて付ける。引けなければファイルを付けない。`newTestNoKills`は`::warning`の注釈にする。他の種類は扱わない。`comparison`が`unavailable`なら、前回の結果と比べていないことを`::notice`の注釈で知らせ、失敗にはしない。
- `detectionRegression`が1件でもあれば終了コードを1、それ以外は0とする。結果のファイルが無ければ、検査を飛ばさず`::error`の注釈を出して1とする。
- 注釈の値の`%`と改行を符号化し、ファイルと題名ではさらに`:`と`,`を符号化する。
- 変更したファイルの一覧に、検査の範囲を決める`mutator.config.json`、`mutator.accepted.json`、`vitest.mutation.config.ts`があれば、ファイルごとに`::warning`の注釈を出す。終了コードは変えない。
- `scripts/mutation-findings.ts`が`.mutator/report/mutation.json`を読み、判定の結果を標準出力に書く。引数に比べる基準のrefを渡すと、そのrefとの差分で変わったファイルの一覧を`git diff --name-only`で得て、設定の変更も判定する。

派生元: SPEC-EXT-005, ARCH-DEPS-001

## リリース

### DES-REL-001 版数と変更履歴の検査

- `scripts/release.ts`の純粋な関数で版数、タグ、対象版の箇条書きを検査し、minorの奇偶と次の第2階層見出しまでの本文を返す。CRLFも受け付け、他の版の本文は混ぜない。
- `scripts/release-check.ts`がNode.jsのファイル操作と環境変数を扱い、検査結果をワークフローへ渡す。パッケージ用スクリプト末尾のvsceに`--pre-release`を渡し、GitHub Releasesには`--prerelease`、MarketplaceとOpen VSXには`--pre-release`を渡す。

- detectはpackage.jsonからversionと`v<version>`のtag、対象のshaを出力する。`git ls-remote --exit-code origin refs/heads/main`のコミットがshaと違えばaction=noneとする。`git ls-remote --exit-code --tags origin "refs/tags/$TAG"`の終了コード0ならaction=bump、2ならaction=releaseを出力する。それ以外は失敗とする。
- `scripts/release.ts`の`prepareRelease`は、`## 未リリース`に箇条書きがなければ`undefined`を返し、あれば次の版数と書き換えたCHANGELOGを返す。`scripts/release-prepare.ts`がpackage.jsonの`"version"`の値とCHANGELOG.mdを書き換え、versionをGITHUB_OUTPUTに出す。
- bumpは`actions/create-github-app-token`でContentsとPull requestsに書き込めるトークンを作り、checkoutと`gh`に使う。versionがあれば、Appのbotユーザーとしてコミットして`release/next`にforce pushし、検査CLIで書き出した対象版の本文をPRの説明にする。`release/next`から開いたPRが無ければ作り、あれば更新し、`gh pr merge --auto --squash`でauto-mergeを設定する。
- releaseはdetectのtagを検査CLIの第1引数と公開に使い、detectのshaをcheckoutし、`gh release create`の`--target "$SHA"`でタグを作る。

派生元: SPEC-REL-001, ARCH-REL-001

### DES-REL-002 変更履歴の項目の検査

- `scripts/release.ts`の`checkChangelog`は、`## 未リリース`の本文を行ごとに読み、`###`の見出しが種別の6つ以外のとき、または最初の種別の見出しより前に箇条書きがあるときに問題を返す。基点のCHANGELOGを渡されたときは、前後の空白を除いた箇条書きの行を比べ、基点に無い行が1つも無ければ問題を返す。
- `scripts/changelog-check.ts`は、引数のrefがあれば`git show <ref>:CHANGELOG.md`を基点とし、問題を標準エラー出力に出して終了コード1にする。
- Changelogワークフローは`no-changelog`ラベルがあればジョブを飛ばし、`git diff --quiet "$BASE" HEAD -- src`で`src/`の変更を確かめたうえで、PRの基点のshaを検査CLIに渡す。

派生元: SPEC-REL-002

### DES-REL-003 画像と紹介動画の撮り直しの検査

- `scripts/media-rules.ts`の`checkMedia`は、変わったファイルの一覧を受け取り、見た目に関わるファイルが含まれ、`docs/images/`と`docs/media/`のファイルが1つも含まれないときに、変わったファイルの名前と`no-media`ラベルの案内を含む問題を返す。
- `scripts/media-check.ts`は、引数のref(既定は`origin/main`)と`HEAD`の差のファイルを`git diff --name-only`で求め、問題を標準エラー出力に出して終了コード1にする。
- Mediaワークフローは`no-media`ラベルがあればジョブを飛ばし、PRの基点のshaを検査CLIに渡す。lefthookのpre-pushは、`origin/main`があるときに同じCLIを実行する。

派生元: SPEC-REL-003
