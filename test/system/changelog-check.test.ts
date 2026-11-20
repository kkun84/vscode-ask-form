import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "vitest"
import { withGitRepo } from "../support/git-repo.ts"

const entry = fileURLToPath(new URL("../../scripts/changelog-check.ts", import.meta.url))

test("SPEC-REL-002 種別の無い項目と、基点から増えない未リリースを拒否する", () =>
  withGitRepo("changelog-check-", async ({ cwd, git, run }) => {
    const check = (...args: ReadonlyArray<string>) => run(entry, ...args)
    await writeFile(join(cwd, "CHANGELOG.md"), "## 未リリース\n\n### 追加\n\n- 既存\n")
    git("add", ".")
    git("commit", "-qm", "base")
    assert.equal(check().status, 0)
    const unchanged = check("HEAD")
    assert.equal(unchanged.status, 1)
    assert.match(unchanged.stderr, /no-changelog/)
    await writeFile(join(cwd, "CHANGELOG.md"), "## 未リリース\n\n### 追加\n\n- 既存\n\n### 修正\n\n- 新規\n")
    assert.equal(check("HEAD").status, 0)
    await writeFile(join(cwd, "CHANGELOG.md"), "## 未リリース\n\n- 既存\n- 新規\n")
    const untyped = check()
    assert.equal(untyped.status, 1)
    assert.match(untyped.stderr, /kind heading/)
  }))
