import assert from "node:assert/strict"
import { test } from "node:test"
import { checkRelease } from "../../scripts/release.ts"

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
        `# 変更履歴\n\n## 未公開\n\n- 次回\n\n## ${version}\n\n### 追加\n\n- フォーム\n\n## 0.0.0\n\n- 過去\n`
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
