import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

test("DES-REL-001 mainの変更と手動実行で検出したタグを検査して実行コミットに公開する", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8")
  assert.match(workflow, /on:\n  push:\n    branches: \[main\]\n    paths: \[package.json, CHANGELOG.md\]\n  workflow_dispatch:/)
  assert.match(workflow, /version: \$\{\{ steps.detect.outputs.version \}\}/)
  assert.match(workflow, /tag: \$\{\{ steps.detect.outputs.tag \}\}/)
  assert.match(workflow, /release: \$\{\{ steps.detect.outputs.release \}\}/)
  assert.match(workflow, /TAG: \$\{\{ needs.detect.outputs.tag \}\}/)
  assert.match(workflow, /node scripts\/release-check.ts "\$TAG" "\$RUNNER_TEMP\/release-notes.md"/)
  assert.match(workflow, /gh release create "\$TAG" .* --title "\$TAG" .* --target "\$GITHUB_SHA"/)
  assert.doesNotMatch(workflow, /GITHUB_REF_NAME|--verify-tag|\n    tags:/)
})
