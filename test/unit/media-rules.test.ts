import assert from "node:assert/strict"
import { test } from "vitest"
import { checkMedia } from "../../scripts/media-rules.ts"

test("DES-REL-003 画面や振る舞いに関わるファイルを変えて、画像も動画も変えていなければ問題を返す", () => {
  assert.equal(checkMedia(["src/ui/app.ts", "README.md"]).length, 1)
  assert.match(checkMedia(["src/extension/shared/formTool.ts"])[0] ?? "", /no-media.*formTool\.ts/)
  for (const file of ["src/core/messages.ts", "test/acceptance/stage.ts", "test/fixtures/todo.ts", "scripts/pv.ts"]) {
    assert.equal(checkMedia([file]).length, 1, file)
  }
})

test("DES-REL-003 画像か動画を撮り直していれば、または見た目に関わらない変更なら問題を返さない", () => {
  assert.deepEqual(checkMedia(["src/ui/app.ts", "docs/images/form.png"]), [])
  assert.deepEqual(checkMedia(["src/ui/app.ts", "docs/media/ask-form-pv.mp4"]), [])
  assert.deepEqual(checkMedia(["src/core/validate.ts", "docs/spec/system.md", "test/system/tool.test.ts"]), [])
  assert.deepEqual(checkMedia([]), [])
})
