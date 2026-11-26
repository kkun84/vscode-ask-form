# 詳細設計

層の中の処理の作りを定めます。各項目は単体テスト(`test/unit`)で検証します。

## 設計図

### DES-SPEC-001 設計図の読み取り

設計図はEffect Schemaで読み取る(`src/core/validate.ts`)。未知のキーは捨てずに誤りにし、`fields[0].when.anyof`の形の場所とキーの名前を日本語の文で示す。AIに示すJSON Schemaも、同じSchemaから未知のキーを許さない形で作る。画面はEffectを使わないため、読み取りと検査は拡張機能の側だけで行う。読み取りの誤りと意味的な検査の誤りは、どちらも「どこが」「なぜ」を含む文の一覧にまとめる。

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

2組の値を項目ごとに比べ、異なる項目を表示の順で返す。複数選択は並び順を無視して比べる。

- 複数選択は入力を変更せずに並べ替え、長さと各要素の一致を調べる。区切り文字でつながず、NUL文字を含む値でも衝突しないようにする。この差分を`changedByUser`と画面の変更表示に使う。

派生元: SPEC-TOOL-003, SPEC-UI-001, ARCH-LAYER-006

### DES-FORM-004 値の検査

画面から届いた値を、項目の種類、範囲、選択肢に照らして検査する。値のない項目の扱いは DES-FORM-007 に従う。

- 複数選択は、すべての要素が選択肢の文字列で、配列の長さと値の集合の大きさが等しい場合だけ受け付ける。重複があれば項目の`id`を含む誤りを返し、計算と回答に渡さない。

派生元: SPEC-TOOL-005, ARCH-LAYER-001

### DES-FORM-006 条件付きの項目

- 項目はすべて設計図の`fields`に平らに並ぶ。`id`の重複、項目の検査、計算式が参照できる`id`、初期値は`fields`の並びで扱う。
- `followUpsOf`は、`when`の参照先の`id`から、その続きの質問を`fields`の順に並べた一覧への対応を作る。`displayOrder`は、`when`のない項目を`fields`の順に置き、各項目の後ろにその続きの質問を深さ優先で置いた表示の順を返す。各項目の参照先は1つなので、`when`のない項目からたどると循環に入らない。循環した項目はどの`when`のない項目からもたどれず、表示の順に入らないが、設計図の検査がこれを拒否する。
- 検査は、各項目の`when`の参照先を、既に見た`id`に戻るまでか、`when`のない項目か未定義の`id`に着くまでたどる。戻ったら循環として、たどった`id`の列を誤りの文に入れる。未定義の`id`は、その`id`を書いた項目の誤りとしてだけ返す。
- `activeFields`は、表示の順に項目を見て、`when`がないか、`when`の参照先が既に有効でその値が`anyOf`のどれかを含む項目を返す。表示の順では参照先が必ず前にあるので、1回の走査で連鎖した条件も決まる。差分、計算式に渡す値の表、値の検査、コメント、`held`はこの並びで扱う。値の検査は、届いた値から有効な項目を決め、それ以外のキーを捨てる。
- `answerValues`は値の表を`activeFields`の項目に絞る。画面は全項目の値を持ち続け、回答のときだけ絞る。
- 差分は`after`の有効な項目について比べる。`before`にない項目は変更とする。`changedByUser`は全項目の初期値と比べるため、現れただけの項目を含めない。
- `heldForm`は、`held`の項目を表示の順に並べ、`held`にない項目を参照する`when`を外す。外さないと、AIが`heldForm`をそのまま聞き直しに使ったとき、未定義の`id`を参照する設計図として拒否される。
- 画面は全項目の質問を表示の順に作っておき、値が変わるたびに`activeFields`にない質問を`hidden`にする。

派生元: SPEC-FORM-001, SPEC-FORM-002, SPEC-TOOL-003, SPEC-UI-011

### DES-FORM-007 値のない回答

値のない回答は、回答の値の表に項目の値がないことで表す。`held`の一覧は値の表から導く(`src/core/form.ts`)。

- `answerValues`は、値のない項目を値の表から除く。空欄の文字列は値として残す。`heldFields`は、有効な項目のうち値の表にない項目の`id`を表示の順に返す。`when`の参照先に値がなければ、その項目は有効にならず、`heldFields`にも入らない。
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

## 画面

### DES-UI-003 続きの質問の線

続きの質問の線は、`.fields`の上に重ねた1枚のSVGに描く(`src/ui/branches.ts`)。SVGは`aria-hidden`で、ポインタのイベントを受けない。質問は字下げせず、`when`のある項目を持つフォームだけ`.fields`の左に余白を設ける。余白の幅は、続きの質問を持つ項目の段の深さの最大から決める。

- 画面は、続きの質問を持つ表示中の項目ごとに筋を1本作り、筋のx座標を段の深さから決める。各選択肢の行と操作要素、表示中の続きの質問の見出しと`anyOf`を渡し、`drawBranches`が`getBoundingClientRect`で`.fields`からの位置を測って、線と点を毎回作り直す。
- 点のx座標は、選択肢の行を囲む`.q-group`の左端とする。`searchChoice`で、選んだ選択肢の行がスクロールか絞り込みで一覧の外にあるときは、点のy座標を`.picked`の行の中央にする。選んでいない選択肢の行が一覧の外にあるときは、点を描かない。一覧のスクロールと絞り込みの入力でも描き直す。
- カーソルかフォーカスのある続きの質問の`id`を覚え、その質問の線と点を最後に描いて上に重ねる。同時に、出している選択肢の行に`revealing`、質問に`hot`を付け、SVGに`dimmed`を付けてほかの線を薄くする。質問が隠れたら覚えた`id`を捨てる。
- 値を変えるたびの再描画は`refresh`から呼ぶ。大きさの変化は`.fields`と各質問を`ResizeObserver`で見て、開閉の動きの途中も描き直す。フォントの読み込みは`document.fonts.ready`で待つ。
- 札と支援技術への説明は値が変わるたびに書き換える。説明は見えない要素に書き、続きの質問の`role="group"`の`aria-describedby`から参照する。選択肢の「選ぶと質問がN個増えます」は、選択肢の操作要素の`aria-describedby`から参照する。

派生元: SPEC-UI-011, SPEC-UI-007, SPEC-UI-008

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

- `scripts/mutation-report.ts`の純粋な関数で、mutatorのJSONの結果を判定する。まず`schemaVersion`が`"2"`で、`comparison`が`available`か`unavailable`で、`findings`が配列で、`files`がオブジェクトかを確かめ、どれかが違えば判定せず`::error`の注釈を出して1とする。形の違うレポートを、指摘の無いレポートとして通さないためである。`findings`と`files`の中の、形の分からない要素は読み飛ばす。
- `comparison`が`unavailable`なら、比べる基準を使えなかったことを`::error`の注釈にし、終了コードを1とする。
- `detectionRegression`はGitHub Actionsの`::error`の注釈にし、ミュータントのファイルと開始行を`files`の`mutants`からidで引いて付ける。引けなければファイルを付けない。文言では、`mutator accept`で通さず、テストを戻すか足すよう案内する。
- `newTestNoKills`は`::warning`の注釈にし、テストのidの`#`の前をファイルとして付ける。`mutationGap`は、`detectionRegression`と同じミュータントを除いて`::warning`の注釈にする。他の種類は扱わない。
- `detectionRegression`が1件でもあれば終了コードを1、それ以外は0とする。
- `summarize`は、判定の全体の出力の注釈を数え、`判定の結果: 失敗 N件(うちテストが弱くなった箇所 M件)、警告 …`の1行を作る。件数には、mutatorの報告だけでなく、判定が自前で出した`::error`(実行し直し、設定を戻した数え直し、`not run:`、一覧の比べ合わせなど)をすべて含める。失敗したのに`::error`が1つも無ければ「判定が失敗した」の`::error`を足す。`scripts/mutation-diff.sh`は判定の全体の最後に`scripts/mutation-summary.ts`でこの1行を1回だけ出し、`scripts/mutation-findings.ts`は基準のrefを渡されない単独の実行の時だけ出す。
- 注釈の値の`%`と改行を符号化し、ファイルと題名ではさらに`:`と`,`を符号化する。
- 変更したファイルの一覧に、検査の範囲を決める`mutator.config.*`(`.ts`、`.mts`、`.mjs`、`.js`、`.json`)、`mutator.accepted.json`、`vitest.mutation.config.ts`と、`tsconfig*.json`があれば、ファイルごとに`::warning`の注釈を出す。判定のスクリプト、`package.json`、`lefthook.yml`、`.github/workflows/`の下のファイルが変わった時は、判定を緩めたり呼ばないようにしたりしていないかを、人が確かめるよう`::warning`の注釈を出す。渡されたテストの設定と準備のファイル(Vitestの設定ファイル、`setupFiles`、`globalSetup`)が変わった時は、アサーションを無力化していないかを人が確かめるよう`::warning`の注釈を出す。終了コードは変えない。
- 分岐点の一覧と今の一覧を比べ、分岐点では集めていたテストファイル、または対象だったソースファイルのうち、今も在るのに今の一覧に無いものごとに`::error`の注釈を出し、終了コードを1とする。分岐点から改名したファイルは改名した先で比べ、消したファイルは比べない。
- `scripts/mutation-findings.ts`が`.mutator/report/mutation.json`を読み、判定の結果を標準出力に書く。ファイルが無い、JSONとして読めない時も`::error`の注釈を出して1とする。引数に比べる基準のrefを渡すと、そのrefとの差分で変わったファイルの一覧を`git diff --no-renames --name-only`で得て、設定の変更も判定する。差分を取れなければ1とする。`--base-scope`と`--scope`に分岐点と今の一覧のファイルを渡すと、改名を`git diff -M --name-status`で得て一覧を比べる。`--test-setup`でテストの設定と準備のファイルを渡す。
- 変えたテストは、レポートの`testChanges`の`changed`と`removed`、`selectionReasons`の`tests`と、差分のファイル(`git diff --no-renames --name-only`と追跡していないファイル)をsnapshotの`deps`(基準と今)で読み込むテストファイルのテストとする。差分のファイルからは、分岐点でmutatorの対象だったソースと、分岐点に無かった新しいファイルだけを除く。分岐点に在って対象でなかったファイルは、今の設定で対象に入っていても除かない。
- `scripts/mutation-rerun.ts`の純粋な関数で、mutatorが選ばなかったミュータントを選ぶ。基準のレポートで`Killed`で、`killedBy`に変えたテストを含み、snapshotの関数の中身のハッシュが基準と今で同じで、`detectionRegression`が出ておらず、今のsnapshotで`kill matrix`の印の付いた`Killed`か`Timeout`ではないもの。
- `scripts/mutation-recheck.ts`が、`.mutator`を退けてこれらを`--only`と`--kill-matrix`で1回実行し、終わったら`.mutator`を戻す。`--reporter text`の出力に`not run:`の行があれば`::error`の注釈を出して1とする。`Survived`か`NoCoverage`なら「テストが弱くなった」の`::error`の注釈を出し、終了コードを1とする。`Killed`、`Timeout`、`RuntimeError`、`CompileError`は検出とみなす。`Ignored`、`Pending`か結果が無ければ「結果が想定と違う」の`::error`の注釈を出し、終了コードを1とする。
- mutatorの設定か環境のファイルが分岐点と違えば、`scripts/mutation-original.ts`が、分岐点の設定に戻したworktreeでミュータントを`--time-budget 0`で数え、今の設定の基準でテストの結果で決まった状態(`Killed`、`Timeout`、`RuntimeError`、`NoCoverage`、`statusReason`に`not infected`を含まない`Survived`)でないものを`--only`で実行する。そのうち`Killed`で、`killedBy`に変えたテストを含み、今の設定の基準で`Killed`でないものを、`scripts/mutation-recheck.ts`が`--only`と`--kill-matrix`で実行する。実行の前に、worktreeを今の作業ツリーのファイル(`git ls-files --cached --others --exclude-standard`)で置き換え、mutatorの設定と環境のファイルだけを分岐点の物に戻す。結果の扱いは上と同じで、文言では設定の変更を別のPRに分けるよう案内する。
- 基準のsnapshotに`Pending`があれば、`::error`の注釈を出して1とする。
- `scripts/mutation-settings.ts`は、基準を作る前に今のmutatorの設定を読み、`timeBudget`、`mutantsPerLine`、`shard`、`sharedCache`、`vitest`以外の`runner`、`jestConfig`、`bunConfig`、`playwrightConfig`があれば、`::error`の注釈を出して1とする。

派生元: SPEC-EXT-005, ARCH-DEPS-001

### DES-TOOLS-004 ミューテーションテストの基準の作成

- `scripts/mutation-diff.sh`は、渡されたrefと`HEAD`の共通の祖先を一時的なworktreeに取り出し、そこで全件を実行した結果を、比べる基準にする。前回の実行の`.mutator`は、別のブランチや別の環境の結果のことがあるので、基準に使わない。
- 知らないオプションには終了コード2を返す。同じ作業ツリーで2つが同時に動かないよう、`.git/mutation-diff.lock`を`flock`(無ければperl)でflock(2)のロックにし、取れなければ`::error`の注釈を出して1とする。ロックのファイルにはプロセスの番号と一時ディレクトリを書き、前の実行が強制終了で残した一時ディレクトリとworktreeの登録を消してから始める。ロックは子のプロセスにも引き継がれるので、親だけを強制終了すると子が終わるまで残る。refが無い時は、`--skip-without-base`を渡した時だけ何もせず0とする。手元の`pnpm mutation:diff`だけが渡し、CIは渡さない。`.mutator`か`.mutator-base`がgitで追跡されていれば、`::error`の注釈を出して1とする。
- worktreeには、まず`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.npmrc`を写し、`pnpm install --frozen-lockfile --offline --ignore-scripts`で依存を入れる。`prepare`のlefthookが、worktreeと共有する`.git/hooks`を書き換えないようにするためである。
- `scripts/mutation-scope.ts`で、Vitestが集めるテストファイルと、mutatorの`include`、`exclude`で対象になるソースファイルの一覧を作る。今の作業ツリーでは今の設定で、worktreeでは依存を入れた直後に分岐点の元の設定で作り、DES-TOOLS-003で比べる。作れなければ`::error`の注釈を出して1とする。mutatorの設定は、mutatorの`loadConfig`で、`mutator.config.ts`、`.mts`、`.mjs`、`.js`、`.json`の順に探して読む。
- 続けて、今の`tsconfig*.json`、`mutator.config.*`と、Vitestの設定ファイルと`setupFiles`と`globalSetup`を、worktreeに上書きで写す(worktreeにだけ在る物は消す)。写す前に、`mutator.config.*`を除くこれらの環境のファイルのうち、中身か有無が分岐点と違うものを数える。全件の実行の後、写したファイルをすべて分岐点の物に戻し、違うものがあるかmutatorの設定が違えば、DES-TOOLS-003の設定を戻した数え直しを行う。mutatorは、Node.jsの版、mutatorの設定、`package.json`、ロックファイル、`tsconfig.json`、`pnpm-workspace.yaml`、Vitestのこれらのファイルの中身が基準と同じ時だけ、基準と比べるためである。Vitestのファイルは、`scripts/mutation-vitest-files.ts`がmutatorの`vitestConfig`の設定を解決して求める。根の外と`node_modules`の中のファイルは写さない。この一覧は`scripts/vitest-files.ts`の純粋な関数で作る。
- 基準の全件の実行は、`.mutator-base/<共通の祖先>-<写したファイルとNode.jsの版のハッシュ>`の基準があればそこから、無ければ最も新しい基準から始める。基準を作れた時だけ、今回の基準を残し、新しい順に3つまで残す。snapshotを写す時は、前の判定の記録の`testReview`を消す。
- 作業ツリーの`.mutator`を基準のスナップショットで置き換え、`mutator --since <共通の祖先> --include-test-changes --kill-matrix --reporter text --reporter json`を実行してから、DES-TOOLS-003の判定を行う。テキストの出力に`not run:`の行があれば`::error`の注釈を出して1とする。判定の各段の出力をまとめ、最後に件数の1行を出す。mutator自身の注釈は`GITHUB_ACTIONS`を空にして止め、判定の注釈だけを出す。
- 共通の祖先が無い、worktreeを作れない、依存を入れられない、基準の全件の実行が失敗した、のどれでも、`::error`の注釈を出して終了コードを1とする。worktreeと一時ディレクトリは、終わり方によらず消す。

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
