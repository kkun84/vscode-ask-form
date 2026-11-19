import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

test("DES-REL-001 mainのCIの成功と手動実行で検出し、版数を上げたコミットか対象のコミットに公開する", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8")
  assert.match(
    workflow,
    /on:\n  workflow_run:\n    workflows: \[CI\]\n    types: \[completed\]\n    branches: \[main\]\n  workflow_dispatch:/
  )
  assert.match(workflow, /github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'/)
  assert.match(workflow, /SHA: \$\{\{ github.event.workflow_run.head_sha \|\| github.sha \}\}/)
  assert.match(workflow, /action: \$\{\{ steps.detect.outputs.action \}\}/)
  assert.match(workflow, /  bump:\n    needs: detect\n    if: needs.detect.outputs.action == 'bump'/)
  assert.match(workflow, /node scripts\/release-prepare.ts/)
  assert.match(workflow, /git push origin HEAD:refs\/heads\/main/)
  assert.match(workflow, /TAG: \$\{\{ needs.bump.outputs.tag \|\| needs.detect.outputs.tag \}\}/)
  assert.match(workflow, /SHA: \$\{\{ needs.bump.outputs.sha \|\| needs.detect.outputs.sha \}\}/)
  assert.match(workflow, /node scripts\/release-check.ts "\$TAG" "\$RUNNER_TEMP\/release-notes.md"/)
  assert.match(workflow, /gh release create "\$TAG" .* --title "\$TAG" .* --target "\$SHA"/)
  assert.doesNotMatch(workflow, /GITHUB_SHA|GITHUB_REF_NAME|--verify-tag|\n    tags:|\n  push:/)
})

test("DES-REL-002 src/を変えたPRだけ、ラベルが無ければ基点と比べて変更履歴を検査する", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/changelog.yml", import.meta.url), "utf8")
  for (const expected of [
    "pull_request:\n    types: [opened, synchronize, reopened, labeled, unlabeled]",
    "if: ${{ !contains(github.event.pull_request.labels.*.name, 'no-changelog') }}",
    'if ! git diff --quiet "$BASE" HEAD -- src; then',
    'node scripts/changelog-check.ts "$BASE"'
  ]) {
    assert.ok(workflow.includes(expected), expected)
  }
})
