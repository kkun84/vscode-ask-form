import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

test("DES-REL-001 mainのCIの成功と手動実行で検出し、版数を上げるPRを自動でマージさせるか対象のコミットに公開する", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8")
  assert.match(
    workflow,
    /on:\n  workflow_run:\n    workflows: \[CI\]\n    types: \[completed\]\n    branches: \[main\]\n  workflow_dispatch:/
  )
  for (const expected of [
    "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'",
    "SHA: ${{ github.event.workflow_run.head_sha || github.sha }}",
    "action: ${{ steps.detect.outputs.action }}",
    "client-id: ${{ vars.RELEASE_APP_CLIENT_ID }}",
    "private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}",
    "token: ${{ steps.app.outputs.token }}",
    "node scripts/release-prepare.ts",
    'git push --force origin "HEAD:refs/heads/$BRANCH"',
    'gh pr create --head "$BRANCH" --base main',
    'gh pr merge "$BRANCH" --auto --squash',
    "TAG: ${{ needs.detect.outputs.tag }}",
    "SHA: ${{ needs.detect.outputs.sha }}",
    'node scripts/release-check.ts "$TAG" "$RUNNER_TEMP/release-notes.md"'
  ]) {
    assert.ok(workflow.includes(expected), expected)
  }
  assert.match(workflow, /gh release create "\$TAG" .* --title "\$TAG" .* --target "\$SHA"/)
  assert.doesNotMatch(workflow, /GITHUB_SHA|GITHUB_REF_NAME|--verify-tag|\n    tags:|\n  push:|HEAD:refs\/heads\/main/)
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
