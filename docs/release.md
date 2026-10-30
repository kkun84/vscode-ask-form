# リリースの基準

## バージョン

バージョンはSemVerの`major.minor.patch`だけを使います。VS Code Marketplaceは`-rc.1`などのプレリリースのタグを受け付けません。minorが奇数(`0.1.x`、`0.3.x`)ならプレリリース、偶数(`0.2.x`、`0.4.x`)なら正式リリースです。これは[VS Codeの公式の推奨](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions)です。

正式リリースの前にプレリリースの版数を上げておくと、プレリリースの利用者が正式版へ戻されません。たとえば`0.2.0`の前に`0.3.0`を配布します。

## プレリリースを出す条件

- mainのCIが、実機のVS Codeでの受け入れテストを含めて成功している。
- 前回の配布から利用者に見える変更(機能追加か不具合の修正)がある。
- CHANGELOG.mdにその版の項がある。

利用者に見える変更が入ったら、まとめて出します。配布は1日に1回までです。

## 正式リリースを出す条件

- 直前のプレリリースを7日以上配布して、影響8以上の不具合の報告がない。
- [手動受け入れ手順](test/manual-acceptance.md)を実際のCopilotのモデルでデスクトップ版とweb版の両方について行い、結果をリリースのPRかIssueに記録した。
- 影響8以上の開いたIssueがない。

## 修正版

正式リリースの不具合の修正は、偶数minorのpatchを上げて出します。

## 手順

1. 配布の条件を確認します。
2. package.jsonのversionとCHANGELOG.mdを更新するコミットをmainに入れます。
3. originに`v<version>`のタグがまだなければ、ワークフローがそのコミットにタグとリリースを作ります。手でタグを付けません。

`workflow_dispatch`で再実行できます。タグが既にあれば公開をスキップします。

あとはリリースのワークフローがタグと版数、変更履歴を検査し、テスト、パッケージ、GitHub Releasesへの公開、ビルドの出所の証明を行います。GitHub Releasesの説明にはその版のCHANGELOGの項を使い、VSIXとSHA256SUMS.txtを添付します。プレリリースはパッケージと各配布先でプレリリースとして扱い、GitHub Releasesにもpre-releaseの印を付けます。

## 配布先

- GitHub Releases: 常に公開します。
- Visual Studio Marketplace: VSCE_PATがあるときに公開します。
- Open VSX: OVSX_PATがあるときに公開します。

CIのVSIX成果物はZIPに包まず単一ファイルとして保存します。失敗時のtest-resultsはディレクトリのためZIPで保存します。
