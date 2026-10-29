import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

const root = new URL("../..", import.meta.url).pathname
const fallow = join(root, "node_modules/.bin/fallow")
const copied = ["src", "test/fixtures", "package.json", "tsconfig.json", ".fallowrc.json", "architecture.rules.json"]

interface Report {
  readonly circular_dependencies: ReadonlyArray<{ readonly files: ReadonlyArray<string> }>
  readonly boundary_violations: ReadonlyArray<{ readonly from_path: string; readonly from_zone: string; readonly to_zone: string }>
  readonly policy_violations: ReadonlyArray<{ readonly path: string; readonly rule_id: string; readonly matched: string }>
}

type Edit = readonly [file: string, code: string]

const analyze = (edits: ReadonlyArray<Edit>): Report => {
  const workspace = mkdtempSync(join(tmpdir(), "copilot-forms-architecture-"))
  try {
    for (const entry of copied) {
      cpSync(join(root, entry), join(workspace, entry), { recursive: true })
    }
    symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"))
    for (const [file, code] of edits) {
      appendFileSync(join(workspace, file), `\n${code}\n`)
    }
    const result = spawnSync(fallow, ["architecture", "--format", "json", "--quiet", "--no-cache"], { cwd: workspace, encoding: "utf8" })
    return JSON.parse(result.stdout) as Report
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

const policies = (report: Report) => report.policy_violations.map((item) => `${item.rule_id} ${item.path} ${item.matched}`)
const boundaries = (report: Report) => report.boundary_violations.map((item) => `${item.from_path} ${item.from_zone}->${item.to_zone}`)

describe("ARCH 規則が実際の配置で守られている", () => {
  it("ARCH-CYCLE-001 今のコードには循環参照も境界の違反もない", () => {
    const report = analyze([])
    assert.deepEqual(report.circular_dependencies, [])
    assert.deepEqual(boundaries(report), [])
    assert.deepEqual(policies(report), [])
  })
})

describe("ARCH-CYCLE-001 循環参照がない", () => {
  it("ARCH-CYCLE-001 循環する依存を見つける", () => {
    const report = analyze([["src/core/hash.ts", 'import { stableHash as again } from "./form.ts"\nexport const probe = again']])
    assert.ok(report.circular_dependencies.some((cycle) => cycle.files.includes("src/core/hash.ts")))
  })
})

describe("ARCH-LAYER-001 中核は純粋", () => {
  it("ARCH-LAYER-001 中核からVS Code、Node.js、ほかの層への依存を見つける", () => {
    const report = analyze([
      [
        "src/core/validate.ts",
        'import * as vscode from "vscode"\nimport { readFileSync } from "node:fs"\nimport { FormHtml } from "../mcp/server.ts"\nexport const probe = [vscode.window, readFileSync, FormHtml]'
      ]
    ])
    assert.deepEqual(policies(report).toSorted(), [
      "ARCH-LAYER-001 src/core/validate.ts node:fs",
      "ARCH-LAYER-001 src/core/validate.ts vscode"
    ])
    assert.deepEqual(boundaries(report), ["src/core/validate.ts core->mcp-tools"])
  })
})

describe("ARCH-LAYER-002 画面はブラウザだけで動く", () => {
  it("ARCH-LAYER-002 画面からEffectと、Effectを使う中核への依存を見つける", () => {
    const report = analyze([
      [
        "src/ui/dom.ts",
        'import { Schema } from "effect"\nimport { compile } from "../core/validate.ts"\nexport const probe = [Schema, compile]'
      ]
    ])
    assert.deepEqual(policies(report), ["ARCH-LAYER-002 src/ui/dom.ts effect"])
    assert.deepEqual(boundaries(report), ["src/ui/dom.ts ui->core"])
  })

  it("ARCH-LAYER-002 設計図の型だけなら参照してよい", () => {
    const report = analyze([["src/ui/dom.ts", 'import type { FormSpec } from "../core/spec.ts"\nexport type Probe = FormSpec']])
    assert.deepEqual(boundaries(report), [])
  })
})

describe("ARCH-LAYER-003 MCPサーバーはVS Codeを知らない", () => {
  it("ARCH-LAYER-003 MCPサーバーからVS Codeと拡張機能への依存を見つける", () => {
    const report = analyze([
      [
        "src/mcp/http.ts",
        'import * as vscode from "vscode"\nimport { postToChat } from "../extension/shared/chat.ts"\nexport const probe = [vscode.window, postToChat]'
      ]
    ])
    assert.deepEqual(policies(report), ["ARCH-LAYER-003 src/mcp/http.ts vscode"])
    assert.deepEqual(boundaries(report), ["src/mcp/http.ts mcp-http->extension-shared"])
  })
})

describe("ARCH-LAYER-004 web版の入口はNode.jsを使わない", () => {
  it("ARCH-LAYER-004 web版の入口からNode.jsとMCPサーバーへの依存を見つける", () => {
    const report = analyze([
      [
        "src/extension/web/main.ts",
        'import { randomUUID } from "node:crypto"\nimport { FormHtml } from "../../mcp/server.ts"\nexport const probe = [randomUUID, FormHtml]'
      ]
    ])
    assert.deepEqual(policies(report), ["ARCH-LAYER-004 src/extension/web/main.ts node:crypto"])
    assert.deepEqual(boundaries(report), ["src/extension/web/main.ts extension-web->mcp-tools"])
  })
})

describe("ARCH-LAYER-005 入口は互いに依存しない", () => {
  it("ARCH-LAYER-005 デスクトップ版の入口からweb版の入口への依存を見つける", () => {
    const report = analyze([["src/extension/node/main.ts", 'import { toolName } from "../web/main.ts"\nexport const probe = toolName']])
    assert.deepEqual(boundaries(report), ["src/extension/node/main.ts extension-node->extension-web"])
  })
})

describe("ARCH-LAYER-006 画面が使う中核はEffectを使わない", () => {
  it("ARCH-LAYER-006 画面が使う中核からEffectとEffectを使う中核への依存を見つける", () => {
    const report = analyze([
      [
        "src/core/hash.ts",
        'import { Schema } from "effect"\nimport { compile } from "./validate.ts"\nexport const probe = [Schema, compile]'
      ]
    ])
    assert.deepEqual(policies(report), ["ARCH-LAYER-006 src/core/hash.ts effect"])
    assert.deepEqual(boundaries(report), ["src/core/hash.ts core-pure->core"])
  })
})

describe("ARCH-EFFECT-001 サービスの定義は実装を知らない", () => {
  it("ARCH-EFFECT-001 サービスの定義から実装とNode.jsへの依存を見つける", () => {
    const report = analyze([
      [
        "src/mcp/ports.ts",
        'import { createServer } from "node:http"\nimport { PendingFormsLive } from "./pending.ts"\nexport const probe = [createServer, PendingFormsLive]'
      ]
    ])
    assert.deepEqual(policies(report), ["ARCH-EFFECT-001 src/mcp/ports.ts node:http"])
    assert.deepEqual(boundaries(report), ["src/mcp/ports.ts ports->mcp-tools"])
  })
})

describe("ARCH-EFFECT-002 ツールの処理は通信手段を知らない", () => {
  it("ARCH-EFFECT-002 ツールの処理からHTTPとNode.jsへの依存を見つける", () => {
    const report = analyze([
      [
        "src/mcp/pending.ts",
        'import { createServer } from "node:http"\nimport { serveForms } from "./http.ts"\nexport const probe = [createServer, serveForms]'
      ]
    ])
    assert.deepEqual(policies(report), ["ARCH-EFFECT-002 src/mcp/pending.ts node:http"])
    assert.deepEqual(boundaries(report), ["src/mcp/pending.ts mcp-tools->mcp-http"])
  })
})

describe("ARCH-EFFECT-003 層を組み立てるのは入口だけ", () => {
  it("ARCH-EFFECT-003 入口のほかから層の組み立てへの依存を見つける", () => {
    const report = analyze([
      ["src/extension/shared/chat.ts", 'import { serveForms } from "../../mcp/http.ts"\nexport const probe = serveForms']
    ])
    assert.deepEqual(boundaries(report), ["src/extension/shared/chat.ts extension-shared->mcp-http"])
  })
})

describe("ARCH-DEPS-001 配布物の依存は限られる", () => {
  it("ARCH-DEPS-001 配布物からテストへの依存を見つける", () => {
    const report = analyze([
      ["src/core/form.ts", 'import { eventSpec } from "../../test/fixtures/event.ts"\nexport const probe = eventSpec']
    ])
    assert.deepEqual(boundaries(report), ["src/core/form.ts core-pure->tests"])
  })

  it("ARCH-DEPS-001 バンドルには自分のコードとeffectだけが入る", () => {
    const meta = JSON.parse(readFileSync(join(root, "dist/meta.json"), "utf8")) as { readonly inputs: Readonly<Record<string, unknown>> }
    const outside = Object.keys(meta.inputs).filter(
      (input) => !input.startsWith("src/") && !/node_modules\/(?:\.pnpm\/effect@[^/]+\/node_modules\/)?effect\//.test(input)
    )
    assert.deepEqual(outside, [])
  })
})
