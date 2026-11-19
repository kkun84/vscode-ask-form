import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import type { McpSchema } from "effect/ai"
import { initialValues } from "../../src/core/form.ts"
import { stableHash } from "../../src/core/hash.ts"
import { resourceMimeType, resourceUri } from "../../src/mcp/server.ts"
import { eventForm, eventSpec } from "../fixtures/event.ts"
import { structured, testHtml, text, withHarness, type Harness } from "../support/server.ts"

const form = eventForm

const reverseKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => reverseKeys(item))
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toReversed()
        .map(([key, item]) => [key, reverseKeys(item)])
    )
  }
  return value
}

const ask = (h: Harness, spec: unknown = eventSpec) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(h.call("ask_form", spec as Record<string, unknown>))
    yield* h.waitUntil(1)
    return fiber
  })

const expectError = (call: Effect.Effect<McpSchema.CallToolResult>, pattern: RegExp) =>
  Effect.map(call, (result) => {
    assert.equal(result.isError, true)
    assert.match(text(result), pattern)
  })

const expectExpired = (h: Harness, formKey: string) => expectError(h.call("form_answer", { formKey, action: "chat" }), /expired/)

const answered = (h: Harness, action: "submit" | "chat") =>
  Effect.gen(function* () {
    const fiber = yield* ask(h)
    yield* h.call("form_answer", { formKey: form.key, action, ...(action === "submit" ? { values: initialValues(form.spec) } : {}) })
    return yield* Fiber.join(fiber)
  })

describe("SPEC-MCP-001 質問のツール", () => {
  it("SPEC-MCP-001 ask_formを読み取り専用で画面つきとして公開する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const tools = yield* h.client.listTools()
        assert.deepEqual(tools.map((tool) => tool.name).toSorted(), ["ask_form", "form_answer", "form_settings", "form_status"])
        const tool = yield* h.tool("ask_form")
        assert.equal(tool.annotations?.readOnlyHint, true)
        assert.equal(tool.annotations?.openWorldHint, false)
        assert.deepEqual((tool._meta as Record<string, unknown>)["ui"], { resourceUri })
        const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
        assert.deepEqual(Object.keys(properties).toSorted(), ["computed", "description", "fields", "title"])
      })
    ))
})

describe("SPEC-MCP-002 画面のリソース", () => {
  it("SPEC-MCP-002 画面をMCP AppsのMIMEタイプのHTMLとして返す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const result = yield* Effect.orDie(h.client.readResource({ uri: resourceUri }))
        const [content] = result.contents
        assert.equal(content?.mimeType, resourceMimeType)
        assert.equal(content !== undefined && "text" in content ? content.text : undefined, testHtml)
      })
    ))
})

describe("SPEC-MCP-003 補足と不在", () => {
  it("SPEC-MCP-003 利用者が不在の設定なら、待たずにunavailableを返し、推奨と自分の判断で進めるよう指示する", () =>
    withHarness(
      (h) =>
        Effect.gen(function* () {
          const result = yield* h.call("ask_form", eventSpec)
          assert.deepEqual(Object.keys(structured(result)), ["status", "next"])
          assert.equal(structured(result)["status"], "unavailable")
          assert.match(text(result), /Do not ask these questions again/)
          assert.deepEqual(yield* Ref.get(h.waiting), [])
          assert.equal((yield* h.call("ask_form", { title: "", fields: [] })).isError, true)
        }),
      { unavailable: true }
    ))

  it("SPEC-MCP-003 待っている間に利用者が不在になったら、待つのをやめてunavailableを返し、以後の回答は受け付けない", () =>
    withHarness(
      (h) =>
        Effect.gen(function* () {
          assert.equal(structured(yield* h.call("ask_form", eventSpec))["status"], "unavailable")
          assert.deepEqual(yield* Ref.get(h.waiting), [1, 0])
          yield* expectExpired(h, form.key)
        }),
      { away: Effect.sleep("50 millis") }
    ))

  it("SPEC-MCP-003 補足は前後の空白を除いてnoteで返し、空の補足は返さない", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const values = initialValues(form.spec)
        const noted = yield* ask(h)
        yield* h.call("form_answer", { formKey: form.key, action: "submit", values, note: "  会場は未定です\n" })
        const result = yield* Fiber.join(noted)
        assert.equal(structured(result)["note"], "会場は未定です")
        assert.match(text(result), /If note is present.*follow it over any value it contradicts.*answers a held field/)
        const plain = yield* ask(h)
        yield* h.call("form_answer", { formKey: form.key, action: "submit", values, note: " \n" })
        assert.equal("note" in structured(yield* Fiber.join(plain)), false)
      })
    ))
})

describe("SPEC-MCP-003 回答を待つ", () => {
  it("SPEC-MCP-003 回答が届くまで待ち、回答をstructuredContentと文章で返す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
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
      })
    ))

  it("SPEC-MCP-003 値のない項目はheldとheldFormで返し、値のある項目のコメントも添える", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* ask(h)
        const { price: _price, format: _format, ...values } = initialValues(form.spec)
        yield* h.call("form_answer", {
          formKey: form.key,
          action: "submit",
          values,
          held: ["format", "price"],
          comments: { price: " 予算が決まったら ", format: "任せる", name: "仮の名前" }
        })
        const result = yield* Fiber.join(fiber)
        const outcome = structured(result)
        assert.deepEqual(outcome["values"], values)
        assert.deepEqual(outcome["held"], ["format", "price"])
        assert.deepEqual(outcome["comments"], { name: "仮の名前", format: "任せる", price: "予算が決まったら" })
        assert.deepEqual(outcome["heldForm"], {
          title: eventSpec.title,
          fields: form.spec.fields.filter((field) => field.id === "format" || field.id === "price")
        })
        assert.deepEqual(outcome["changedByUser"], [])
        assert.deepEqual(outcome["computed"], { cost: 170000, profit: null, breakEven: null })
        assert.match(text(result), /follow each for its field.*let you decide.*does not matter.*heldForm/)
      })
    ))

  it("SPEC-MCP-005 値もコメントもない項目、値のある項目のheld、文字列でないコメントと補足、長すぎる補足を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        yield* ask(h)
        const { price: _price, ...values } = initialValues(form.spec)
        yield* expectError(h.call("form_answer", { formKey: form.key, action: "submit", values, held: ["price"] }), /price.*コメントが必要/)
        yield* expectError(
          h.call("form_answer", { formKey: form.key, action: "submit", values: initialValues(form.spec), held: ["price"] }),
          /price.*できません/
        )
        yield* expectError(
          h.call("form_answer", { formKey: form.key, action: "submit", values: initialValues(form.spec), comments: { price: 1 } }),
          /price.*コメント/
        )
        const noted = { formKey: form.key, action: "submit", values: initialValues(form.spec) }
        yield* expectError(h.call("form_answer", { ...noted, note: 1 }), /note/)
        yield* expectError(h.call("form_answer", { ...noted, note: "x".repeat(2001) }), /note/)
        assert.equal(structured(yield* h.call("form_status", { formKey: form.key }))["status"], "pending")
      })
    ))

  it("SPEC-MCP-003 チャットで答える場合は作業を区切る指示を返す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const result = yield* answered(h, "chat")
        assert.equal(structured(result)["status"], "answer_in_chat")
        assert.match(text(result), /End your turn/)
      })
    ))
})

describe("SPEC-MCP-004 設計図の誤り", () => {
  it("SPEC-MCP-004 誤った設計図は待たずに問題の一覧を返す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        yield* expectError(
          h.call("ask_form", { title: "t", fields: [{ type: "number", id: "n", label: "N", min: 9, max: 1 }] }),
          /minがmax以上/
        )
        assert.deepEqual(yield* Ref.get(h.waiting), [])
      })
    ))

  it("SPEC-MCP-004 型の合わない設計図も誤りとして返す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const result = yield* h.call("ask_form", { title: "t", fields: "none" })
        assert.equal(result.isError, true)
      })
    ))
})

describe("SPEC-MCP-005 回答を受け取るツール", () => {
  it("SPEC-MCP-005 回答の呼び出しを待機数の通知中に中断しても質問は結果を受け取る", () => {
    const notifying = Deferred.makeUnsafe<boolean>()
    return withHarness(
      (h) =>
        Effect.gen(function* () {
          const waiting = yield* ask(h)
          const answering = yield* Effect.forkChild(h.call("form_answer", { formKey: form.key, action: "chat" }))
          yield* Deferred.await(notifying)
          yield* Fiber.interrupt(answering)
          const result = yield* Fiber.join(waiting).pipe(Effect.timeout("1 second"))
          assert.equal(structured(result)["status"], "answer_in_chat")
          assert.equal(structured(yield* h.call("form_status", { formKey: form.key }))["status"], "answered")
        }),
      { onWaiting: (count) => (count === 0 ? Deferred.succeed(notifying, true).pipe(Effect.andThen(Effect.never)) : Effect.void) }
    )
  })

  it("SPEC-MCP-005 画面専用でAIからは見えない印を持つ", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        for (const name of ["form_answer", "form_settings", "form_status"]) {
          const tool = yield* h.tool(name)
          assert.deepEqual((tool._meta as Record<string, unknown>)["ui"], { resourceUri, visibility: ["app"] })
        }
      })
    ))

  it("SPEC-MCP-005 同じ鍵の待機には先に始まったものから順に渡す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const first = yield* ask(h)
        const second = yield* Effect.forkChild(h.call("ask_form", eventSpec))
        yield* h.waitUntil(2)
        yield* h.call("form_answer", { formKey: form.key, action: "chat" })
        assert.equal(structured(yield* Fiber.join(first))["status"], "answer_in_chat")
        yield* h.call("form_answer", { formKey: form.key, action: "submit", values: initialValues(form.spec) })
        assert.equal(structured(yield* Fiber.join(second))["status"], "submitted")
      })
    ))

  it("SPEC-MCP-005 設計図に合わない値は誤りとして返し、待機は続く", () =>
    withHarness((h) =>
      Effect.gen(function* () {
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
      })
    ))

  it("SPEC-MCP-005 待機のない鍵は受け付けない", () => withHarness((h) => expectExpired(h, "0000000000000000")))
})

describe("SPEC-MCP-006 フォームの鍵", () => {
  it("SPEC-MCP-006 画面が受け取った引数から計算した鍵で回答できる", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const args = { computed: eventSpec.computed, fields: eventSpec.fields, title: eventSpec.title, extra: { nested: true } }
        const fiber = yield* ask(h, args)
        const reordered = reverseKeys(args)
        assert.notEqual(stableHash(args), form.key)
        const answer = yield* h.call("form_answer", { formKey: stableHash(reordered), action: "chat" })
        assert.equal(answer.isError, false)
        yield* Fiber.join(fiber)
      })
    ))
})

describe("SPEC-MCP-007 中断", () => {
  it("SPEC-MCP-007 取り消された待機は消え、以後の回答は受け付けない", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* ask(h)
        yield* Fiber.interrupt(fiber)
        yield* h.waitUntil(0)
        assert.equal(structured(yield* h.call("form_status", { formKey: form.key }))["status"], "cancelled")
        yield* expectExpired(h, form.key)
      })
    ))

  it("SPEC-MCP-007 HTTPを切断せずにnotifications/cancelledを送ると対象の待機だけが終了する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const rpc = yield* rawSession(h)
        const call = yield* Effect.forkChild(
          rpc({ id: "stop-me", method: "tools/call", params: { name: "ask_form", arguments: eventSpec } })
        )
        yield* h.waitUntil(1)
        assert.equal(structured(yield* h.call("form_status", { formKey: form.key }))["status"], "pending")
        const otherSpec = { ...eventSpec, title: "Another question" }
        const other = yield* Effect.forkChild(h.call("ask_form", otherSpec))
        yield* h.waitUntil(2)
        const notification = yield* rpc({ method: "notifications/cancelled", params: { requestId: "stop-me" } })
        assert.equal(notification.status, 202)
        yield* h.waitUntil(1)
        assert.equal(structured(yield* h.call("form_status", { formKey: form.key }))["status"], "cancelled")
        yield* expectExpired(h, form.key)
        yield* h.call("form_answer", { formKey: stableHash(otherSpec), action: "chat" })
        assert.equal(structured(yield* Fiber.join(other))["status"], "answer_in_chat")
        yield* h.waitUntil(0)
        yield* Fiber.interrupt(call)
      })
    ))

  it("SPEC-MCP-007 未知の鍵と回答済みの鍵は中断と区別し、状態の確認では待機数を変えない", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(structured(yield* h.call("form_status", { formKey: form.key }))["status"], "unknown")
        yield* answered(h, "submit")
        assert.equal(structured(yield* h.call("form_status", { formKey: form.key }))["status"], "answered")
        assert.deepEqual(yield* Ref.get(h.waiting), [1, 0])
      })
    ))
})

const rawSession = (h: Harness) =>
  Effect.gen(function* () {
    const controller = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (value) => Effect.sync(() => value.abort())
    )
    const headers: Record<string, string> = {
      authorization: `Bearer ${h.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25"
    }
    const rpc = (message: Record<string, unknown>) =>
      Effect.promise(() =>
        fetch(h.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", ...message }), signal: controller.signal })
      )
    const initialized = yield* rpc({
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "stop-test", version: "1" } }
    })
    const sessionId = initialized.headers.get("mcp-session-id")
    assert.ok(sessionId)
    headers["mcp-session-id"] = sessionId
    yield* Effect.promise(() => initialized.text())
    yield* rpc({ method: "notifications/initialized" })
    return rpc
  })

describe("SPEC-MCP-010 画面の設定のツール", () => {
  it("SPEC-MCP-010 利用者の設定したコメントの定型文を返し、設定がなければnullを返す", async () => {
    await withHarness((h) =>
      Effect.gen(function* () {
        assert.deepEqual(structured(yield* h.call("form_settings", {})), { commentPresets: null })
      })
    )
    await withHarness(
      (h) =>
        Effect.gen(function* () {
          assert.deepEqual(structured(yield* h.call("form_settings", {})), { commentPresets: ["保留", "任せる"] })
        }),
      { commentPresets: ["保留", "任せる"] }
    )
  })
})

const post = (url: string, headers: Record<string, string>) =>
  Effect.promise(() =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
    }).then((response) => response.status)
  )

describe("SPEC-MCP-009 接続の保護", () => {
  it("SPEC-MCP-009 127.0.0.1の空いているポートだけで待ち受ける", () =>
    withHarness((h) =>
      Effect.sync(() => {
        assert.match(h.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
      })
    ))

  it("SPEC-MCP-009 トークンのない要求とOriginつきの要求を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(yield* post(h.url, {}), 401)
        assert.equal(yield* post(h.url, { authorization: "Bearer wrong" }), 401)
        assert.equal(yield* post(h.url, { authorization: `Bearer ${h.token}`, origin: "https://evil.example" }), 403)
      })
    ))
})
