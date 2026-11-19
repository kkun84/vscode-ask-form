# リリースの基準

## バージョン

バージョンはSemVerの`major.minor.patch`だけを使います。VS Code Marketplaceは`-rc.1`などのプレリリースのタグを受け付けません。minorが奇数(`0.1.x`、`0.3.x`)ならプレリリース、偶数(`0.2.x`、`0.4.x`)なら正式リリースです。これは[VS Codeの公式の推奨](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions)です。

プレリリースのpatchは、出すたびに1つ上げる通し番号です。不具合の修正だけを表すものではありません。

正式リリースの前にプレリリースの版数を上げておくと、プレリリースの利用者が正式版へ戻されません。たとえば`0.2.0`の前に`0.3.0`を配布します。

## プレリリースを出す条件

プレリリースは、mainへのマージごとに自動で出します。次の条件をすべて満たすと、リリースのワークフローが版数を上げるリリースPRを作り、そのPRがマージされると公開します。

- mainのCIが、実機のVS Codeでの受け入れテストを含めて成功している。
- CIが成功したコミットが、その時点のmainの先頭である。
- CHANGELOG.mdの`## 未リリース`に項目がある。書き方は[変更履歴の書き方](changelog.md)にあります。

## 正式リリースを出す条件

- 直前のプレリリースを7日以上配布して、重大な不具合の報告がない。
- [手動受け入れ手順](test/manual-acceptance.md)を実際のCopilotのモデルでデスクトップ版とweb版の両方について行い、結果をリリースのPRかIssueに記録した。
- 重大な不具合の開いたIssueがない。

重大な不具合とは、フォームが表示されない、送信できない、送信した回答がCopilotに届かない、回答が利用者の入れた値と違う、のいずれかを指します。

## 修正版

正式リリースの不具合の修正は、偶数minorのpatchを上げて出します。

## 手順

### プレリリース

人の操作は要りません。条件を満たすと、ワークフローが次のことを行います。

1. package.jsonのversionを上げます。minorが奇数ならpatchを1つ上げ(`0.3.0`→`0.3.1`)、偶数なら次の奇数のminorの`.0`にします(`0.4.2`→`0.5.0`)。
2. CHANGELOG.mdの`## 未リリース`を`## <version>`に書き換え、その上に空の`## 未リリース`を置きます。
3. この2つの変更をGitHub Appのコミットとして`release/next`ブランチにforce pushし、mainへのリリースPRを作ります。既に開いていれば、タイトルと説明を更新します。PRにはauto-mergeを設定します。
4. リリースPRのCIが成功するとsquashでマージされ、mainのCIが成功すると、そのコミットに`v<version>`のタグとリリースを作ります。

リリースPRがマージされる前に別のPRがmainに入ると、そのmainのCIの成功で`release/next`を作り直し、新しい項目もリリースPRに含めます。

### リリース用のGitHub App

版数を上げるコミットとリリースPRは、GitHub Appのトークンで作ります。`GITHUB_TOKEN`で作ったPRとpushでは、CIのワークフローが動かないためです。

1. 個人のアカウントにGitHub Appを作ります。Repository permissionsはContentsとPull requestsをRead and writeにします。Webhookは要りません。
2. Appをこのリポジトリだけにインストールします。
3. AppのClient IDをリポジトリのVariablesに`RELEASE_APP_CLIENT_ID`として、秘密鍵をSecretsに`RELEASE_APP_PRIVATE_KEY`として登録します。
4. リポジトリのSettingsでAllow auto-mergeを有効にします。
5. mainにルールセットを作り、PRを必須にし、CIの`check`とChangelogの`entry`を必須のステータスチェックにします。Bypass listには何も加えません。

### 正式リリースと修正版

1. 配布の条件を確認します。
2. package.jsonのversionとCHANGELOG.mdを更新するコミットをmainに入れます。CHANGELOG.mdでは、`## 未リリース`と直前のプレリリースの項から正式版に入る項目をまとめ、`## <version>`の項を作ります。
3. mainのCIが成功すると、originに`v<version>`のタグがまだなければ、ワークフローがそのコミットにタグとリリースを作ります。手でタグを付けません。

`workflow_dispatch`で再実行できます。タグが既にあれば、`## 未リリース`の項目をプレリリースとして公開します。

## 配布先

- GitHub Releases: 常に公開します。
- Visual Studio Marketplace: VSCE_PATがあるときに公開します。
- Open VSX: OVSX_PATがあるときに公開します。

CIのVSIX成果物はZIPに包まず単一ファイルとして保存します。失敗時のtest-resultsはディレクトリのためZIPで保存します。
