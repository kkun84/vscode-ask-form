<h1 align="center">Ask Form</h1>

<p align="center">
  GitHub Copilotが、チャットの横に出るフォームであなたに質問できるようにするVS Codeの拡張機能
</p>

<p align="center">
  <a href="https://github.com/kkun84/vscode-ask-form/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/kkun84/vscode-ask-form/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="VS Code 1.110+" src="https://img.shields.io/badge/VS%20Code-1.110%2B-007ACC.svg">
  <img alt="Desktop and Web" src="https://img.shields.io/badge/platform-desktop%20%7C%20web-555.svg">
</p>

<p align="center">
  <img src="docs/images/demo.webp" alt="Copilotが出したフォームで、保存先をブラウザからサーバーに変えると、保存方式の質問がポート番号とログインの要否の質問に入れ替わる様子" width="720">
</p>

Copilotは、仕事を進める途中で利用者に確認したいことがよくあります。文章でやり取りすると、1つ答えるたびに次の質問が来て、何度も往復することになります。「保存先はサーバーで」と答えると「ではポート番号は？」と続く、という具合です。

Ask Formを入れると、Copilotは聞きたいことを**1つのフォームにまとめて**聞けます。続きの質問も、**選んだ答えに応じて**同じフォームの中に現れます。各質問には、Copilotが勧める答えとその理由が最初から入っています。利用者は違うところだけを直し、ボタンを1回押せば答え終わり、Copilotは同じ作業の流れのまま、受け取った値で続きを進めます。

## 目次

- [特徴](#特徴)
- [スクリーンショット](#スクリーンショット)
- [動作環境](#動作環境)
- [インストール](#インストール)
- [使い方](#使い方)
- [フォームの設計図](#フォームの設計図)
- [しくみ](#しくみ)
- [よくある質問](#よくある質問)
- [開発](#開発)
- [ライセンス](#ライセンス)

## 特徴

- **往復せずに1回で聞き切る**: 聞きたいことを1つのフォームにまとめて聞けます。「送信」を押すと、回答がそのままツールの結果としてCopilotに届きます。チャットに打ち直す必要はありません。
- **選んだ答えに応じて続きを聞ける**: 「保存先がサーバーならポート番号も聞く」のように、選択肢ごとに続きの項目を持たせられます。利用者には選んだ選択肢に関係する項目だけが見え、Copilotにも関係する値だけが届きます。
- **推奨と理由が分かるフォーム**: Copilotが勧める選択肢には「推奨」の印と理由が付きます。どの選択肢にも、それが何か、選ぶとどうなるかの説明が付くので、選択肢の意味をCopilotに聞き直さずに済みます。推奨から変えた項目は、Copilotにも伝わります。
- **推奨のない質問も聞ける**: Copilotが根拠を持って勧められない質問は、何も選ばれていない状態で出ます。推奨のない単一選択と数値の質問は、答えるか、コメントを書くまで送信できません。
- **答え終えた質問は畳む**: 選択肢を選ぶと、その質問の詳しい説明と推奨の理由が畳まれ、フォーム全体を見渡せます。質問名を押せば、また開きます。
- **決める前に結果が分かる**: 選んだ値から計算される値を、フォームの中で示せます。たとえばメモの最大文字数を上げると、保存できる件数がどれだけ減るかがその場で分かります。
- **答えない質問はコメントだけで返せる**: 単一選択は選択肢の下の「選択を解除」で、数値は入力欄を空にして値を外し、「他の要件を先に決める。」「この質問の意味がわからない。説明が足りない。」のようなコメントを書けば、値を答えずに送信できます。推奨のない質問は、何も選ばずにコメントを書くだけで送れます。Copilotは値を決めつけず、コメントに従います。必要になれば、その質問をフォームで聞き直します。
- **質問ごとにコメントを添えられる**: 見出しの右端の吹き出しのアイコンを押すと、その質問について伝えたいことを書けます。値だけ、コメントだけ、両方のどれでも送れます。よく使う文は定型文のボタンで入れられます。既定の定型文は「他の要件を先に決める。」「この質問の意味がわからない。説明が足りない。」「インターネットで調査した上でもう一度検討しよう。」の3つで、設定`askForm.commentPresets`で変えられます。
- **選択肢にない答えも1回で伝わる**: 「補足を書く」を開くと、選択肢にない答えや、Copilotに伝えたいことを文章で添えられます。答えが選択肢に合わないからといって、フォームをキャンセルして全部をチャットに書き直す必要はありません。
- **ボタンは「送信」と「キャンセル」だけ**: フォームで答えたくないときは「キャンセル」を押し、チャットに文章で答えます。
- **待っていることが分かる**: Copilotが回答を待っている間は、ステータスバーに「Copilotが回答を待っています」と表示されます。押すとフォームのパネルが前面に出ます。チャットを止めると、パネルも閉じます。
- **デスクトップ版とweb版**: どちらもチャットの横のパネルにフォームを表示します。パネルは、送信するか、キャンセルするか、チャットを停止すると閉じます。
- **考える時間を気にしなくてよい**: 回答に何分かけても、回答はCopilotに届きます。
- **VS Codeになじむ見た目**: 配色はVS Codeのテーマ(ライト、ダーク、ハイコントラスト)に合わせ、表示は日本語と英語に対応します。キーボードだけでも操作できます。

## スクリーンショット

### 聞きたいことが1つのフォームで届く

「フォームで聞いて」と頼むと、Copilotは聞きたいことを1つのフォームにまとめて出します。各質問には、ワークスペースや会話からCopilotが勧める答えと、その理由が入っています。保存先が「ブラウザ」の今は、その下に保存方式だけを聞いています。

![Copilotが出したTODOアプリの設定のフォーム。保存先はブラウザが選ばれ、その下に一段下げて保存方式の質問がある](docs/images/form.png)

### 選んだ答えに応じて続きを聞く

保存先に「サーバー」を選ぶと、保存方式の代わりに、ポート番号とログインの要否の質問が現れます。回答には、選んだ保存先に関係する値だけが入ります。

![保存先にサーバーを選んだフォーム。保存先の下に、一段下げてポートとログインの要否の項目が表示されている](docs/images/branch.png)

### 回答すると、Copilotが同じ流れで続ける

「送信」を押すと、1回で全部の答えが届きます。パネルが閉じ、Copilotは受け取った値で作業を続けます。

![回答するとパネルが閉じ、受け取った値で続けるCopilotの返答](docs/images/answered.png)

## 動作環境

- VS Code 1.110以降(デスクトップ版、またはvscode.devなどのweb版)
- GitHub Copilot Chat。ほかのモデルをBYOKでつないだ場合も使えます。
- エージェントのモード

## インストール

0.1.xはプレリリースです。GitHub Releasesでもpre-releaseの印が付きます。配布条件は[リリースの基準](docs/release.md)を参照してください。

### GitHub Releasesから

1. [Releases](https://github.com/kkun84/vscode-ask-form/releases)から`ask-form-<バージョン>.vsix`をダウンロードします。
2. VS Codeのコマンドパレットで「拡張機能: VSIX からのインストール...」を実行し、ダウンロードしたファイルを選びます。

コマンドラインからも入れられます。

```sh
code --install-extension ask-form-<バージョン>.vsix
```

### ソースから

```sh
git clone https://github.com/kkun84/vscode-ask-form.git
cd vscode-ask-form
nix develop
pnpm install
pnpm package
code --install-extension ask-form-*.vsix
```

## 使い方

1. チャットを開き、モードを「エージェント」にします。
2. ツールの一覧で「Ask Form」が有効になっていることを確かめます。
3. 確認が必要な作業を頼みます。Copilotが必要と判断したときにフォームが出ます。明示的に頼むこともできます。

たとえば、次のように頼みます。

```text
TODOアプリを新しく作りたいです。設定をフォームで聞いてください。
```

```text
このAPIのレート制限の設定を一緒に決めたい。候補の値と影響が分かるようにフォームで確認して。
```

フォームでは次の操作ができます。

| 操作                             | 結果                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| 送信(Ctrl/⌘+⏎)                   | 入力した値がCopilotに届く。直した項目と、答えずに送った質問も伝わる    |
| 選択を解除(単一選択の下)         | 選択を外し、コメントだけで送れるようにする。Copilotはコメントに従う    |
| 吹き出しのアイコン(各質問の右上) | その質問について伝えたいことを、回答に添えて送信する。定型文から選べる |
| 補足を書く                       | 選択肢にない答えや、Copilotに伝えたいことを、回答に添えて送信する      |
| キャンセル                       | 送信せずにフォームを閉じ、チャットに文章で答える                       |

## フォームの設計図

Copilotは、次のようなJSONでフォームを指定します。利用者が書く必要はありませんが、Copilotに何を聞かせられるかの目安になります。

```json
{
  "title": "TODOアプリの設定",
  "description": "README.mdのメモから考えました。",
  "fields": [
    {
      "type": "text",
      "id": "name",
      "label": "アプリ名",
      "description": "画面の上に出る名前で、保存するデータの名前にも使います。",
      "default": "my-todo",
      "reason": "フォルダ名と同じにすると、どのアプリか見分けやすくなります。"
    },
    {
      "type": "choice",
      "id": "framework",
      "label": "画面の作り方",
      "options": [
        { "value": "react", "label": "React", "description": "部品を組み合わせて画面を作る。情報や作例が最も多い。" },
        { "value": "vue", "label": "Vue", "description": "HTMLに近い書き方で画面を作る。覚えることが少ない。" },
        { "value": "svelte", "label": "Svelte", "description": "出来上がりが軽く、表示が速い。" }
      ],
      "default": "react",
      "reason": "README.mdに「Reactで」とあり、そのまま進められます。",
      "reasonDetails": "package.jsonにもReactの部品がすでに入っているので、追加の準備なしで作り始められます。"
    },
    {
      "type": "number",
      "id": "memoMax",
      "label": "メモの最大文字数",
      "default": 100,
      "min": 100,
      "max": 5000,
      "step": 100,
      "suffix": "文字"
    },
    { "type": "number", "id": "pageSize", "label": "1ページの件数", "default": 20, "min": 5, "max": 100, "step": 5, "suffix": "件" },
    {
      "type": "choice",
      "id": "due",
      "label": "締め切り",
      "options": [
        { "value": "yes", "label": "付けられる", "description": "TODOごとに期限の日付を入れられる。" },
        { "value": "no", "label": "付けない", "description": "TODOは文章だけ。入力欄が一つ減る。" }
      ]
    },
    {
      "type": "number",
      "id": "titleMax",
      "label": "タイトルの最大文字数",
      "default": 100,
      "min": 20,
      "max": 500,
      "step": 10,
      "suffix": "文字",
      "advanced": true
    }
  ],
  "computed": [
    {
      "id": "size",
      "label": "1件の最大サイズ",
      "expression": "round(((titleMax + memoMax) * 2 + 200) / 1024, 1)",
      "suffix": " KB",
      "decimals": 1
    },
    { "id": "capacity", "label": "ブラウザに保存できる件数", "expression": "floor(5120 / size)", "suffix": " 件", "primary": true }
  ]
}
```

| 項目の種類 | できること                                                      |
| ---------- | --------------------------------------------------------------- |
| `text`     | 1行または複数行の文字列                                         |
| `number`   | スライダーと数値の入力。範囲、刻み、単位(`件`や`¥`)を指定できる |
| `choice`   | 選択肢。単一選択と複数選択。選択肢は6個まで                     |

オンとオフを聞くときは、2択の選択肢にします。選択肢と同じく、推奨と説明を付けられます。

計算結果の式では、四則演算、比較、論理演算、条件式、`min` `max` `abs` `floor` `ceil` `round`を使えます。

項目には次を付けられます。

| キー            | 内容                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `description`   | 質問が何を聞いているか、値が何に使われるか                                                              |
| `default`       | 推奨する値。根拠があるときだけ付ける。ないときは、何も選ばれていない状態で出る                          |
| `reason`        | 推奨の理由を一文で。選択肢以外の項目では、値を決める助けになる助言。`default`のある項目にだけ付けられる |
| `reasonDetails` | 推奨の詳しい理由。利用者が畳める。`default`のある項目にだけ付けられる                                   |
| `advanced`      | 真なら「詳細」の中に畳む                                                                                |

選択肢には、それが何か、選ぶとどうなるかを一文で書く`description`と、得失を詳しく書く`details`を付けられます。

利用者はどの質問も、値を外してコメントだけで返せます。値のない質問は回答の`values`に入らず、`held`に`id`が並び、`heldForm`にその質問の設計図が入ります。たとえば締め切りの値を外して「他の要件を先に決める。」と書くと`"held": ["due"]`、`"comments": { "due": "他の要件を先に決める。" }`となります。値のある質問にもコメントを付けられます。空欄のまま送った文字列の質問は、空文字列が`values`に入ります。利用者が補足を書くと、その文章が回答の`note`に入ります。

単一選択の選択肢には`fields`を付けられます。その選択肢を選んだときだけ、`fields`の項目が選択肢のすぐ下に現れます。

```json
{
  "type": "choice",
  "id": "storage",
  "label": "保存先",
  "default": "browser",
  "options": [
    {
      "value": "browser",
      "label": "ブラウザ",
      "fields": [
        {
          "type": "choice",
          "id": "engine",
          "label": "保存方式",
          "options": [
            { "value": "local", "label": "localStorage" },
            { "value": "indexed", "label": "IndexedDB" }
          ]
        }
      ]
    },
    {
      "value": "server",
      "label": "サーバー",
      "fields": [{ "type": "number", "id": "port", "label": "ポート", "default": 8080, "min": 1, "max": 65535 }]
    },
    { "value": "none", "label": "保存しない" }
  ]
}
```

回答の`values`には、選んだ選択肢の`fields`の項目だけが入ります。たとえば「サーバー」なら`{ "storage": "server", "port": 8080 }`となり、`engine`は入りません。`fields`の中の選択項目に、さらに`fields`を付けることはできません。

すべてのキーと制約は[システム仕様](docs/spec/system.md#spec-form-001-設計図の形)にあります。

## しくみ

拡張機能は、VS Codeの言語モデルのツール`forms_ask_form`(チャットでは`#askForm`)を登録します。Copilotがこのツールを呼ぶと、Webviewのパネルにフォームを表示し、回答をツールの結果として返します。デスクトップ版とweb版で同じしくみです。

- 以前はMCPサーバーとして動かし、フォームをチャットの中に描いていました。VS Codeのハーネス(Copilot、Claude、Codex)は、MCPのツールの呼び出しを1分から5分で打ち切ります。そのため、それより長く考えた利用者の回答がCopilotに届きませんでした。VS Codeのツールの呼び出しは、CopilotとCodexのハーネスでは打ち切られません。
- 拡張機能はポートを開かず、外から回答を送る口を持ちません。

### ハーネスとウィンドウ

VS Codeのチャットでは、エージェントを動かすハーネスを選べます。VS Code 1.146と1.147で確かめた対応は次のとおりです。

| ハーネス | メインウィンドウ | Agentsウィンドウ |
| -------- | ---------------- | ---------------- |
| Copilot  | 使える           | 使える           |
| Codex    | 使える           | 使える           |
| Claude   | 使えない         | 使えない         |

- Claudeのハーネスは、Ask Formのツールを呼んでも、VS Codeがツールを実行せずに止まります。VS Codeの不具合とみています。
- Codexは、モデルによってツールの渡し方が違います。GPT-5.5ではツールを直接呼び、GPT-6.1-Solなど新しいモデル(Agentsウィンドウの既定)では、JavaScriptを実行するツール`exec`の中から`tools.askForm(...)`として呼びます(コードモード)。どちらでも使えます。
- 配布物が使う外部パッケージは[Effect](https://effect.website)だけです。

## よくある質問

<details>
<summary>フォームが出ません。</summary>

チャットのモードが「エージェント」か、ツールの一覧で「Ask Form」が有効かを確かめてください。Copilotがフォームを使う必要がないと判断することもあるので、「フォームで聞いて」と頼むと確実です。

</details>

<details>
<summary>席を外している間に、フォームで作業が止まりませんか？</summary>

VS Codeの設定`chat.autoReply`を有効にすると、Ask Formはフォームを出して待つ代わりに、利用者が不在であることをCopilotに伝えます。Copilotは推奨した値と自分の判断で進めます。この設定は、VS Codeの組み込みの質問にも同じように効きます。

</details>

<details>
<summary>パスワードなどの秘密も聞かれますか？</summary>

Copilotには、秘密や認証情報をフォームで聞かないように指示しています。

</details>

## 開発

配布の条件と手順は[リリースの基準](docs/release.md)にあります。

開発環境はnixで用意します。実機のVS Codeでの受け入れテストには、VS Codeを含む`nix develop .#acceptance`を使います。このVS Codeは、nixpkgsとは別に`flake.nix`で版を固定しています。公開から3日たった最新の安定版を使い、新しい版が出たら版と各OS向けのハッシュ(`nix-prefetch-url https://update.code.visualstudio.com/<版>/<OS>/stable`)を更新します。

```sh
nix develop
pnpm install
pnpm build
```

| コマンド                 | 内容                                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`              | oxlint、oxfmt、fallow(未使用のコード、重複、循環参照、層の境界、複雑さ)、markdownlint、コメントとトレーサビリティの検査                                                                                                                                  |
| `pnpm typecheck`         | TypeScript 7とEffectの診断による型検査                                                                                                                                                                                                                   |
| `pnpm check`             | lint、型検査、単体・アーキテクチャ・システムのテスト、配布物の大きさの検査をまとめて実行。CIは同じ検査を1つずつ動かす                                                                                                                                    |
| `pnpm test`              | 単体、アーキテクチャ、システム、画面のテスト                                                                                                                                                                                                             |
| `pnpm test:acceptance`   | 実際のVS Code(デスクトップ版、web版、チャット、ハーネス)での受け入れテスト                                                                                                                                                                               |
| `pnpm media`             | 実際のVS CodeでREADMEの画像、GIF、紹介動画(`docs/images`、`docs/media`)を撮り直す。紹介動画のBGMは、曲のファイルを`scripts/music/`に置いたときだけ入る([`docs/media/README.md`](docs/media/README.md))                                                   |
| `pnpm mutation`          | 単体テストによるミューテーションテストを全件で実行。結果は`.mutator/report`。失敗にしない指標                                                                                                                                                            |
| `pnpm mutation:diff`     | `origin/main`との差分と、変更したテストが確かめるコードだけのミューテーションテスト。何も検出しない新しいテストはCIが探す。検出できなかったミュータントは表示だけで失敗にしない                                                                          |
| `pnpm mutation:findings` | 直前のミューテーションテストの結果から、テストが弱くなった箇所(失敗にする)と何も検出しない新しいテスト(警告)を、GitHub Actionsの注釈の形で出す。比べる基準のref(例: `origin/main`)を渡すと、ミューテーションテストの設定ファイルが変わったときも警告する |
| `pnpm budget`            | 配布物の大きさの検査                                                                                                                                                                                                                                     |
| `pnpm traceability`      | `docs/traceability.md`の生成                                                                                                                                                                                                                             |
| `pnpm package`           | `.vsix`の作成                                                                                                                                                                                                                                            |

画面や拡張機能、画面の文言、撮影の台本を変えたPRでは、`pnpm media`でREADMEの画像と紹介動画を撮り直してください。撮り直していないと、CIのMediaとpushの前のフックが失敗します。見た目が変わらない変更なら、PRに`no-media`ラベルを付けます。

コミットの前に[lefthook](https://github.com/evilmartians/lefthook)が、変更したファイルの整形と、検査と単体テストを実行します(設定は`lefthook.yml`)。pushの前には`pnpm mutation:diff`と`pnpm mutation:findings origin/main`を実行し、検出できなかったミュータントの件数と、見直しの手順を表示します。テストが弱くなった箇所があればpushを止めます。それ以外では止めません。`origin/main`が無い環境では何もしません。Linuxでは受け入れテストと`pnpm media`を`xvfb-run`の中で動かします。

### 実機での受け入れテスト

受け入れテストは、実際のVS CodeとビルトインのCopilot Chatを動かし、[Playwright Test](https://playwright.dev/docs/test-intro)で画面を操作して確かめます(設定は`playwright.acceptance.config.ts`)。チャットのモデルには、決まった応答を返すLLM APIのスタブをBYOK(Custom Endpoint)としてつなぎ、フォームの表示、回答、中断までを通します。テストは1件ずつ新しいチャットを開くので、互いに依存しません。READMEの画像と動画も、同じスタブと起動のしくみで撮っています。

テストは、動かす環境ごとに2つのプロジェクトに分かれます。

| プロジェクト | 環境                                                                      | テスト                                                                         |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `desktop`    | デスクトップ版のVS Code(Electron)                                         | 起動(`desktop.spec.ts`)、チャット(`chat.spec.ts`)、ハーネス(`harness.spec.ts`) |
| `web`        | サーバーにつないだweb版(VS Codeのサーバーとブラウザ)とブラウザだけのweb版 | チャット(`chat.spec.ts`)、ブラウザだけのweb版(`web.spec.ts`)                   |

- チャットのテストは、デスクトップ版と、サーバーにつないだweb版の両方で、同じ内容を動かします。サーバーにつないだweb版は、GitHub Codespacesなどと同じく、拡張機能とCopilotがサーバーの側で動く形です。VS Codeのサーバーは、デスクトップ版と同じコミットの物を初回にダウンロードし、`node_modules/.cache/ask-form-vscode-server`に置きます。
- ブラウザだけのweb版にはCopilotが無いので、`web.spec.ts`は、テスト用の拡張機能のコマンドからツールを直接呼びます。
- 利用者と同じ状態で確かめるために、Ask FormはVSIXにまとめてインストールしてから起動します。開発用のパスで読み込んだ拡張機能は、Agentsウィンドウの制限を受けないなど、インストールした拡張機能と扱いが違うためです。ブラウザだけのweb版だけは、テスト用のサーバーの都合で、ビルドしたフォルダーから読み込みます。
- `pnpm test:acceptance chat`のようにファイル名の一部を渡すと、そのテストだけを動かせます。`pnpm test:acceptance --project=desktop`で、プロジェクトを選べます。

CopilotとCodexのハーネスも、同じようにLLM APIのスタブで確かめます(`harness.spec.ts`)。スタブはOpenAI Chat CompletionsとOpenAI Responsesに答え、Codexのコードモードの`exec`の呼び出しも真似ます。CopilotはBYOKのモデルとして、Codexは環境変数`CODEX_HOME`の設定でスタブに向けます。Agentsウィンドウでも確かめます。Copilotのハーネスは、多くのモデルで拡張機能のツールを最初の一覧に入れず、モデルが検索してから読み込みます。受け入れテストでは、設定`chat.agentHost.copilot.modelCapabilityOverrides`でスタブのモデルをGPT-5.5として扱わせ、ツールの検索のスタブを登録して、この経路を通します。各ハーネスのSDKはVS Codeが初回にダウンロードし、`node_modules/.cache/ask-form-agent-sdk`に置きます。Codexはbubblewrapでサンドボックスを作るので、Ubuntu 24.04では`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`が要ります。環境変数`ASK_FORM_E2E_ANSWER_DELAY_MS`を与えると、フォームが出てからその時間だけ待ってから回答し、待つ間に回答が返っていないことも確かめます。リリースのワークフローは、版も中身も固定できないSDKを公開の権限のあるジョブで動かさないよう、`harness.spec.ts`を流しません。

### 文書とテストの対応

V字モデルに沿って、要求から設計までを段階ごとの文書に書き、各段階に対応するテストで検証します。

| 文書                          | ID     | 検証                                                |
| ----------------------------- | ------ | --------------------------------------------------- |
| `docs/spec/requirements.md`   | `REQ`  | 受け入れテスト(`test/acceptance`)、手動受け入れ手順 |
| `docs/spec/system.md`         | `SPEC` | システムテスト(`test/system`)                       |
| `docs/design/architecture.md` | `ARCH` | アーキテクチャテスト(`test/architecture`)           |
| `docs/design/detailed.md`     | `DES`  | 単体テスト(`test/unit`)                             |

テストの名前はIDで始めます。`scripts/traceability.ts`が、すべての項目に派生元と検証があることを確かめ、`docs/traceability.md`を作ります。

### 決まり

- ソースコードにコメントを書きません(`scripts/no-comments.ts`で検査します)。
- 依存は少なく保ちます。配布物が使う外部パッケージは`effect`だけです。
- テストの実行時間と配布物の大きさの上限は`budgets.json`にあります。
- ミューテーションテストの結果は、失敗にしない指標です。CIはPRで、変更した行の検出できなかったミュータントに警告を付けます。失敗にするのは、変わっていないコードのミュータントを前は検出していたのに検出できなくなった、つまりテストを弱めた変更だけです。何も検出しない新しいテストは警告になります。
- コードやテストを変えたら`pnpm mutation:diff`を実行します。検出できなかったミュータントには、そのミュータントで変わる振る舞いを確かめるテストを足します。どんな入力でも振る舞いが変わらないミュータントだけを、`pnpm exec mutator accept <key> --reason <理由>`で`mutator.accepted.json`に記録します。テストが弱くなった箇所を通すために記録してはいけません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足します。`<key>`は`pnpm exec mutator --since origin/main --reporter agent`の出力にあります。手順は`node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md`にあります。
- ミューテーションテストの数字を満たすためだけのテストは書きません。テストは振る舞いを確かめるために書きます。

## ライセンス

[MIT](LICENSE)

紹介動画の効果音には、[Kenney](https://kenney.nl)のCC0の音源を使っています。出典は[`scripts/sounds/SOURCES.md`](scripts/sounds/SOURCES.md)にあります。
