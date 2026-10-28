import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Fiber, Ref, Result } from "effect"
import type { McpSchema } from "effect/ai"
import { compile, initialValues, type CompiledForm } from "../../src/core/form.ts"
import { resourceMimeType, resourceUri } from "../../src/mcp/server.ts"
import { eventSpec } from "../fixtures/event.ts"
import { harness, runScoped, testHtml, type Harness } from "../support/server.ts"

const form: CompiledForm = (() => {
  const result = compile(eventSpec)
  if (Result.isFailure(result)) {
    throw new Error(result.failure.join("\n"))
  }
  return result.success
})()

const structured = (result: McpSchema.CallToolResult): Record<string, unknown> =>
  (result.structuredContent ?? {}) as Record<string, unknown>

const text = (result: McpSchema.CallToolResult): string =>
  result.content.map((item) => ("text" in item ? String(item.text) : "")).join("\n")

const ask = (h: Harness, spec: unknown = eventSpec) =>
  Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(h.call("ask_form", spec as Record<string, unknown>))
    yield* h.waitUntil(1)
    return fiber
  })

describe("SPEC-MCP-001 質問のツール", () => {
  it("SPEC-MCP-001 ask_formを読み取り専用で画面つきとして公開する", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const tool = yield* h.tool("ask_form")
      assert.equal(tool.annotations?.readOnlyHint, true)
      assert.deepEqual((tool._meta as Record<string, unknown>)["ui"], { resourceUri })
      const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      assert.deepEqual(Object.keys(properties).sort(), ["computed", "description", "fields", "submitLabel", "title"])
    })))
})

describe("SPEC-MCP-002 画面のリソース", () => {
  it("SPEC-MCP-002 画面をMCP AppsのMIMEタイプのHTMLとして返す", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const result = yield* Effect.orDie(h.client.readResource({ uri: resourceUri }))
      const [content] = result.contents
      assert.equal(content?.mimeType, resourceMimeType)
      assert.equal(content !== undefined && "text" in content ? content.text : undefined, testHtml)
    })))
})

describe("SPEC-MCP-003 回答を待つ", () => {
  it("SPEC-MCP-003 回答が届くまで待ち、回答をstructuredContentと文章で返す", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const fiber = yield* ask(h)
      assert.equal(fiber.pollUnsafe(), undefined)
      const values = { ...initialValues(form.spec), price: 2500 }
      const answer = yield* h.call("form_answer", { formKey: form.key, action: "submit", values })
      assert.equal(answer.isError, false)
      const result = yield* Fiber.join(fiber)
      const outcome = structured(result)
      assert.equal(outcome["status"], "submitted")
      assert.deepEqual(outcome["changedByUser"], ["price"])
      assert.deepEqual(outcome["values"], values)
      assert.deepEqual(outcome["computed"], { cost: 170000, profit: 130000, breakEven: 68 })
      assert.match(text(result), /"status":"submitted"/)
    })))

  it("SPEC-MCP-003 AIに任せた場合は推測値のまま返す", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const fiber = yield* ask(h)
      yield* h.call("form_answer", { formKey: form.key, action: "delegate" })
      const outcome = structured(yield* Fiber.join(fiber))
      assert.equal(outcome["status"], "delegated")
      assert.deepEqual(outcome["values"], initialValues(form.spec))
    })))

  it("SPEC-MCP-003 チャットで答える場合は作業を区切る指示を返す", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const fiber = yield* ask(h)
      yield* h.call("form_answer", { formKey: form.key, action: "chat" })
      const result = yield* Fiber.join(fiber)
      assert.equal(structured(result)["status"], "answer_in_chat")
      assert.match(text(result), /End your turn/)
    })))
})

describe("SPEC-MCP-004 設計図の誤り", () => {
  it("SPEC-MCP-004 誤った設計図は待たずに問題の一覧を返す", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const result = yield* h.call("ask_form", {
        title: "t",
        fields: [{ type: "number", id: "n", label: "N", min: 9, max: 1 }]
      })
      assert.equal(result.isError, true)
      assert.match(text(result), /minがmax以上/)
      assert.deepEqual(yield* Ref.get(h.waiting), [])
    })))

  it("SPEC-MCP-004 型の合わない設計図も誤りとして返す", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const result = yield* h.call("ask_form", { title: "t", fields: "none" })
      assert.equal(result.isError, true)
    })))
})

describe("SPEC-MCP-005 回答を受け取るツール", () => {
  it("SPEC-MCP-005 画面専用でAIからは見えない印を持つ", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      for (const name of ["form_answer", "form_resend"]) {
        const tool = yield* h.tool(name)
        assert.deepEqual((tool._meta as Record<string, unknown>)["ui"], { resourceUri, visibility: ["app"] })
      }
    })))

  it("SPEC-MCP-005 同じ鍵の待機には先に始まったものから順に渡す", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const first = yield* ask(h)
      const second = yield* Effect.forkChild(h.call("ask_form", eventSpec))
      yield* h.waitUntil(2)
      yield* h.call("form_answer", { formKey: form.key, action: "chat" })
      assert.equal(structured(yield* Fiber.join(first))["status"], "answer_in_chat")
      yield* h.call("form_answer", { formKey: form.key, action: "delegate" })
      assert.equal(structured(yield* Fiber.join(second))["status"], "delegated")
    })))

  it("SPEC-MCP-005 設計図に合わない値は誤りとして返し、待機は続く", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const fiber = yield* ask(h)
      const bad = yield* h.call("form_answer", {
        formKey: form.key,
        action: "submit",
        values: { ...initialValues(form.spec), attendees: 9999 }
      })
      assert.equal(bad.isError, true)
      assert.match(text(bad), /attendees/)
      assert.equal(fiber.pollUnsafe(), undefined)
      yield* h.call("form_answer", { formKey: form.key, action: "chat" })
      yield* Fiber.join(fiber)
    })))

  it("SPEC-MCP-005 待機のない鍵は受け付けない", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const result = yield* h.call("form_answer", { formKey: "0000000000000000", action: "chat" })
      assert.equal(result.isError, true)
      assert.match(text(result), /expired/)
    })))
})

describe("SPEC-MCP-006 フォームの鍵", () => {
  it("SPEC-MCP-006 キーの並びや未知のキーが違う設計図でも同じ鍵で回答できる", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const reordered = { computed: eventSpec.computed, fields: eventSpec.fields, title: eventSpec.title, description: eventSpec.description, extra: true }
      const fiber = yield* ask(h, reordered)
      const answer = yield* h.call("form_answer", { formKey: form.key, action: "chat" })
      assert.equal(answer.isError, false)
      yield* Fiber.join(fiber)
    })))
})

describe("SPEC-MCP-007 中断", () => {
  it("SPEC-MCP-007 取り消された待機は消え、以後の回答は受け付けない", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const fiber = yield* ask(h)
      yield* Fiber.interrupt(fiber)
      yield* h.waitUntil(0)
      const result = yield* h.call("form_answer", { formKey: form.key, action: "chat" })
      assert.equal(result.isError, true)
      assert.match(text(result), /expired/)
    })))
})

describe("SPEC-MCP-008 送り直しのツール", () => {
  it("SPEC-MCP-008 差分の文章と全項目の値を投稿させる", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const before = initialValues(form.spec)
      const after = { ...before, price: 2500 }
      const result = yield* h.call("form_resend", { spec: eventSpec, before, after, locale: "ja" })
      assert.equal(result.isError, false)
      assert.deepEqual(yield* Ref.get(h.posts), [{
        text: "「交流会の条件」で参加費を¥2,500に変えたので、反映して続けてください。",
        title: "交流会の条件",
        values: after
      }])
    })))

  it("SPEC-MCP-008 差分がなければ誤りを返し、投稿しない", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      const values = initialValues(form.spec)
      const result = yield* h.call("form_resend", { spec: eventSpec, before: values, after: values })
      assert.equal(result.isError, true)
      assert.match(text(result), /no changes/)
      assert.deepEqual(yield* Ref.get(h.posts), [])
    })))

  it("SPEC-MCP-008 投稿できなかったことを誤りとして返す", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness({ failPosting: true })
      const before = initialValues(form.spec)
      const result = yield* h.call("form_resend", { spec: eventSpec, before, after: { ...before, price: 0 } })
      assert.equal(result.isError, true)
      assert.match(text(result), /chat unavailable/)
    })))
})

describe("SPEC-MCP-009 接続の保護", () => {
  const post = (url: string, headers: Record<string, string>) =>
    Effect.promise(() =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
      }).then((response) => response.status)
    )

  it("SPEC-MCP-009 127.0.0.1の空いているポートだけで待ち受ける", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      assert.match(h.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    })))

  it("SPEC-MCP-009 トークンのない要求とOriginつきの要求を拒否する", () =>
    runScoped(Effect.gen(function*() {
      const h = yield* harness()
      assert.equal(yield* post(h.url, {}), 401)
      assert.equal(yield* post(h.url, { authorization: "Bearer wrong" }), 401)
      assert.equal(yield* post(h.url, { authorization: `Bearer ${h.token}`, origin: "https://evil.example" }), 403)
    })))
})
