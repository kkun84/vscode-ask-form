import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { listenLocally } from "../support/listen.ts"

export interface AgentToolCall {
  readonly api: "messages" | "responses"
  readonly id: string
  readonly name: string
}

export interface FakeAgents {
  readonly origin: string
  readonly toolCalls: Array<AgentToolCall>
  readonly toolResults: Array<{ readonly id: string; readonly text: string }>
  readonly toolNames: Array<ReadonlyArray<string>>
  readonly close: () => Promise<void>
}

type Json = Readonly<Record<string, unknown>>

const records = (value: unknown): ReadonlyArray<Json> =>
  Array.isArray(value) ? value.filter((item): item is Json => typeof item === "object" && item !== null) : []

const text = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }
  return records(value)
    .map((part) => (typeof part["text"] === "string" ? part["text"] : typeof part["content"] === "string" ? part["content"] : ""))
    .join("")
}

const isAskForm = (name: string): boolean => /(^|[_.])ask_form$/.test(name) && !name.startsWith("forms_")

const readBody = async (req: IncomingMessage): Promise<Json> => {
  const chunks: Array<Buffer> = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  return raw === "" ? {} : (JSON.parse(raw) as Json)
}

const sse = (res: ServerResponse, events: ReadonlyArray<readonly [string, Json]>): void => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  res.end(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""))
}

type Reply = { readonly kind: "text"; readonly text: string } | { readonly kind: "tool"; readonly name: string; readonly input: Json }

export const startFakeAgents = async (trigger: string, args: Json, done = "FAKE_AGENT_DONE", other = "ok"): Promise<FakeAgents> => {
  const toolCalls: FakeAgents["toolCalls"] = []
  const toolResults: FakeAgents["toolResults"] = []
  const toolNames: FakeAgents["toolNames"] = []
  let sequence = 0
  const nextId = (prefix: string) => `${prefix}_${++sequence}`

  const decide = (asked: boolean, answered: boolean, searched: boolean, names: ReadonlyArray<string>, search: string | undefined) => {
    if (!asked) {
      return undefined
    }
    if (answered) {
      return { kind: "text", text: done } as const
    }
    const askForm = names.find(isAskForm)
    if (askForm !== undefined) {
      return { kind: "tool", name: askForm, input: args } as const
    }
    if (search !== undefined && !searched) {
      return { kind: "tool", name: search, input: { query: "ask form", max_results: 5 } } as const
    }
    return { kind: "text", text: `NO_ASK_FORM ${names.join(",")}` } as const
  }

  const messages = (body: Json, res: ServerResponse): void => {
    const history = records(body["messages"])
    const names = records(body["tools"]).flatMap((tool) => (typeof tool["name"] === "string" ? [tool["name"]] : []))
    toolNames.push(names)
    const lastUser = history.findLast((message) => message["role"] === "user" && text(message["content"]).length > 0)
    const uses = history
      .filter((message) => message["role"] === "assistant")
      .flatMap((message) => records(message["content"]))
      .filter((part) => part["type"] === "tool_use")
    const results = history.flatMap((message) => records(message["content"])).filter((part) => part["type"] === "tool_result")
    for (const result of results) {
      const id = String(result["tool_use_id"])
      if (toolCalls.some((call) => call.id === id) && !toolResults.some((item) => item.id === id)) {
        toolResults.push({ id, text: text(result["content"]) })
      }
    }
    const asked = history.some((message) => message["role"] === "user" && text(message["content"]).includes(trigger))
    const answered = uses.some((use) => isAskForm(String(use["name"])))
    const searched = uses.some((use) => /tool_?search/i.test(String(use["name"])))
    const reply: Reply = decide(
      asked && lastUser !== undefined,
      answered,
      searched,
      names,
      names.find((name) => /tool_?search/i.test(name))
    ) ?? { kind: "text", text: other }
    const id = nextId("msg")
    const start = {
      type: "message_start",
      message: { id, type: "message", role: "assistant", model: body["model"], content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } }
    }
    const blocks: ReadonlyArray<readonly [string, Json]> =
      reply.kind === "text"
        ? [
            ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
            ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply.text } }]
          ]
        : (() => {
            const call = { api: "messages", id: nextId("toolu"), name: reply.name } as const
            if (isAskForm(reply.name)) {
              toolCalls.push(call)
            }
            return [
              ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: call.id, name: call.name, input: {} } }],
              [
                "content_block_delta",
                { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(reply.input) } }
              ]
            ] as const
          })()
    const stop = reply.kind === "text" ? "end_turn" : "tool_use"
    if (body["stream"] !== true) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ...start.message, content: [{ type: "text", text: reply.kind === "text" ? reply.text : "" }], stop_reason: stop }))
      return
    }
    sse(res, [
      ["message_start", start],
      ...blocks,
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } }],
      ["message_stop", { type: "message_stop" }]
    ])
  }

  const responses = (body: Json, res: ServerResponse): void => {
    const input = records(body["input"])
    const tools = records(body["tools"])
    const loaded = input
      .filter((item) => item["type"] === "tool_search_output")
      .flatMap((item) => records(item["tools"]))
    const qualified = (tool: Json): ReadonlyArray<string> =>
      tool["type"] === "namespace" ? records(tool["tools"]).map((inner) => `${String(tool["name"])}.${String(inner["name"])}`) : [String(tool["name"])]
    const names = [...tools, ...loaded].filter((tool) => typeof tool["name"] === "string").flatMap(qualified)
    toolNames.push(names)
    for (const item of input.filter((entry) => entry["type"] === "function_call_output")) {
      const id = String(item["call_id"])
      if (toolCalls.some((call) => call.id === id) && !toolResults.some((result) => result.id === id)) {
        toolResults.push({ id, text: text(item["output"]) })
      }
    }
    const asked = input.some((item) => item["type"] === "message" && item["role"] === "user" && text(item["content"]).includes(trigger))
    const answered = input.some((item) => item["type"] === "function_call" && isAskForm(`${String(item["namespace"] ?? "")}.${String(item["name"])}`))
    const searched = input.some((item) => item["type"] === "tool_search_call")
    const search = tools.some((tool) => tool["type"] === "tool_search") ? "tool_search" : undefined
    const reply: Reply = decide(asked, answered, searched, names, search) ?? { kind: "text", text: other }
    const base = { id: nextId("resp"), object: "response", created_at: 0, model: body["model"], status: "in_progress", output: [] }
    let item: Json
    if (reply.kind === "text") {
      item = { type: "message", id: nextId("msg"), role: "assistant", status: "completed", content: [{ type: "output_text", text: reply.text, annotations: [] }] }
    } else if (reply.name === "tool_search") {
      item = { type: "tool_search_call", id: nextId("ts"), call_id: nextId("call"), execution: "client", status: "completed", arguments: reply.input }
    } else {
      const dot = reply.name.lastIndexOf(".")
      const call = { api: "responses", id: nextId("call"), name: reply.name } as const
      toolCalls.push(call)
      item = {
        type: "function_call",
        id: nextId("fc"),
        call_id: call.id,
        name: dot < 0 ? reply.name : reply.name.slice(dot + 1),
        ...(dot < 0 ? {} : { namespace: reply.name.slice(0, dot) }),
        arguments: JSON.stringify(reply.input),
        status: "completed"
      }
    }
    const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }
    sse(res, [
      ["response.created", { type: "response.created", response: base }],
      ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item }],
      ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item }],
      ["response.completed", { type: "response.completed", response: { ...base, status: "completed", output: [item], usage } }]
    ])
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? "").split("?")[0] ?? ""
    const body = await readBody(req)
    if (path.endsWith("/messages/count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 1 }))
    } else if (path.endsWith("/messages")) {
      messages(body, res)
    } else if (path.endsWith("/responses")) {
      responses(body, res)
    } else {
      res.writeHead(404).end()
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500)
      }
      res.end()
    })
  })
  const { origin, close } = await listenLocally(server)
  return { origin, toolCalls, toolResults, toolNames, close }
}
