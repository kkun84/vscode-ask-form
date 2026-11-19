import assert from "node:assert/strict"
import { test } from "vitest"
import { checkChangelog, checkRelease, prepareRelease } from "../../scripts/release.ts"

test("DES-REL-001 minorの奇偶で配布種別を決め対象の変更履歴だけを返す", () => {
  for (const [version, prerelease] of [
    ["0.1.0", true],
    ["0.3.12", true],
    ["0.2.1", false],
    ["1.0.0", false],
    ["2.10.0", false]
  ] as const) {
    assert.deepEqual(
      checkRelease(
        version,
        `v${version}`,
        `# 変更履歴\n\n## 未リリース\n\n- 次回\n\n## ${version}\n\n### 追加\n\n- フォーム\n\n## 0.0.0\n\n- 過去\n`
      ),
      {
        prerelease,
        notes: "### 追加\n\n- フォーム"
      }
    )
  }
})

test("DES-REL-001 SemVerの数字3組以外とタグの不一致を拒否する", () => {
  for (const version of ["0.1.0-rc.1", "0.1.0+build", "01.1.0", "0.01.0", "0.1.00", "0.1", "v0.1.0", "0.1.0\n"]) {
    assert.throws(() => checkRelease(version, `v${version}`, `## ${version}\n- 変更`), /plain major.minor.patch/)
    assert.throws(() => prepareRelease(version, "## 未リリース\n- 変更"), /plain major.minor.patch/)
  }
  for (const tag of ["", "0.1.0", "v0.2.0"]) {
    assert.throws(() => checkRelease("0.1.0", tag, "## 0.1.0\n- 変更"), /Tag must match/)
  }
})

test("DES-REL-001 対象版の見出しと空でない箇条書きを必須にする", () => {
  for (const changelog of ["", "## 0.1.00\n- 別版", "## 0.1.0\n文章", "## 0.1.0\n-   \n## 0.0.0\n- 過去", "### 0.1.0\n- 変更"]) {
    assert.throws(() => checkRelease("0.1.0", "v0.1.0", changelog), /CHANGELOG/)
  }
  assert.equal(checkRelease("0.1.0", "v0.1.0", "## 0.1.0\r\n\r\n* 変更\r\n").notes, "* 変更")
})

test("DES-REL-001 未リリースの項目を次のプレリリースの版にする", () => {
  const changelog = "# 変更履歴\n\n## 未リリース\n\n### 追加\n\n- 新機能\n\n## 0.3.0\n\n- 過去\n"
  for (const [version, next] of [
    ["0.3.0", "0.3.1"],
    ["0.3.9", "0.3.10"],
    ["0.4.2", "0.5.0"],
    ["1.0.0", "1.1.0"]
  ] as const) {
    assert.deepEqual(prepareRelease(version, changelog), {
      version: next,
      changelog: `# 変更履歴\n\n## 未リリース\n\n## ${next}\n\n### 追加\n\n- 新機能\n\n## 0.3.0\n\n- 過去\n`
    })
  }
  assert.equal(
    prepareRelease("0.3.1", "## 0.3.1\r\n- 済み\r\n## 未リリース\r\n\r\n- 次\r\n")?.changelog,
    "## 0.3.1\n- 済み\n## 未リリース\n\n## 0.3.2\n\n- 次\n"
  )
})

test("DES-REL-001 未リリースが無いか項目が無ければ版を上げない", () => {
  for (const changelog of [
    "",
    "## 0.3.0\n- 過去",
    "## 未リリース\n\n## 0.3.0\n- 過去",
    "## 未リリース\n\n### 追加\n\n-  \n",
    "## 未リリース"
  ]) {
    assert.equal(prepareRelease("0.3.0", changelog), undefined)
  }
})

test("DES-REL-002 未リリースの項目を種別の見出しの下に置かせる", () => {
  assert.deepEqual(checkChangelog("## 未リリース\n\n### 追加\n\n- 新機能\n\n### 修正\n\n- 不具合\n\n## 0.3.0\n\n- 種別のない過去\n"), [])
  assert.deepEqual(checkChangelog("## 未リリース\n\n## 0.3.0\n- 過去\n"), [])
  assert.match(checkChangelog("## 0.3.0\n- 過去\n").join(), /must contain a "## 未リリース"/)
  assert.match(checkChangelog("## 未リリース\n\n- 種別なし\n").join(), /must be under a kind heading/)
  assert.match(checkChangelog("## 未リリース\n\n### Added\n\n- 英語\n").join(), /Unknown kind "Added"/)
})

test("DES-REL-002 基点に無い項目が未リリースに無ければ問題を返す", () => {
  const base = "## 未リリース\n\n### 追加\n\n- 既存\n\n## 0.3.0\n\n- 新規\n"
  assert.deepEqual(checkChangelog("## 未リリース\n\n### 追加\n\n- 既存\n- 新規\n", base), [])
  assert.deepEqual(checkChangelog("## 未リリース\n\n### 追加\n\n- 既存を直した\n", base), [])
  assert.match(checkChangelog(base, base).join(), /label the pull request no-changelog/)
  assert.match(checkChangelog("## 未リリース\n\n### 変更\n\n  - 既存  \n", base).join(), /label the pull request no-changelog/)
  assert.deepEqual(checkChangelog("## 未リリース\n\n### 追加\n\n- 既存\n", ""), [])
})
