import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "vitest"

const root = fileURLToPath(new URL("../..", import.meta.url))
const fallow = join(root, "node_modules/.bin/fallow")
const copied = ["src", "test/fixtures", "package.json", "tsconfig.json", ".fallowrc.json", "architecture.rules.json"]

interface Report {
  readonly circular_dependencies: ReadonlyArray<{ readonly files: ReadonlyArray<string> }>
  readonly boundary_violations: ReadonlyArray<{ readonly from_path: string; readonly from_zone: string; readonly to_zone: string }>
  readonly policy_violations: ReadonlyArray<{ readonly path: string; readonly rule_id: string; readonly matched: string }>
}

type Edit = readonly [file: string, code: string]

const analyze = (edits: ReadonlyArray<Edit>): Report => {
  const workspace = mkdtempSync(join(tmpdir(), "ask-user-form-architecture-"))
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
        'import * as vscode from "vscode"\nimport { readFileSync } from "node:fs"\nimport { panelHtml } from "../extension/shared/panel.ts"\nexport const probe = [vscode.window, readFileSync, panelHtml]'
      ]
    ])
    assert.deepEqual(policies(report).toSorted(), [
      "ARCH-LAYER-001 src/core/validate.ts node:fs",
      "ARCH-LAYER-001 src/core/validate.ts vscode"
    ])
    assert.deepEqual(boundaries(report), ["src/core/validate.ts core->extension-shared"])
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

describe("ARCH-DEPS-001 配布物の依存は限られる", () => {
  it("ARCH-DEPS-001 配布物からテストへの依存を見つける", () => {
    const report = analyze([
      ["src/core/form.ts", 'import { eventSpec } from "../../test/fixtures/event.ts"\nexport const probe = eventSpec']
    ])
    assert.deepEqual(boundaries(report), ["src/core/form.ts core-pure->tests"])
  })

  it("ARCH-DEPS-001 バンドルには自分のコードとeffectとUI SDKだけが入る", () => {
    const meta = JSON.parse(readFileSync(join(root, "dist/meta.json"), "utf8")) as { readonly inputs: Readonly<Record<string, unknown>> }
    const outside = Object.keys(meta.inputs).filter(
      (input) =>
        !input.startsWith("src/") &&
        !/node_modules\/(?:\.pnpm\/effect@[^/]+\/node_modules\/)?effect\//.test(input) &&
        !/node_modules\/(?:\.pnpm\/@ui-sdk\+(?:core|web)@[^/]+\/node_modules\/)?@ui-sdk\/(?:core|web)\//.test(input)
    )
    assert.deepEqual(outside, [])
  })
})

describe("ARCH-NET-001 通信の口を開かない", () => {
  it("ARCH-NET-001 拡張機能から通信の口を開くモジュールへの依存を見つける", () => {
    const report = analyze([
      [
        "src/extension/shared/waiting.ts",
        'import { createServer } from "node:http"\nimport { connect } from "net"\nexport const probe = [createServer, connect]'
      ]
    ])
    assert.deepEqual(policies(report).toSorted(), [
      "ARCH-NET-001 src/extension/shared/waiting.ts net",
      "ARCH-NET-001 src/extension/shared/waiting.ts node:http"
    ])
  })
})
