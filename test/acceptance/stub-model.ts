import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { listenLocally } from "../support/listen.ts"

export interface ModelToolCall {
  readonly api: "responses" | "chat"
  readonly id: string
  readonly name: string
}

export interface StubModel {
  readonly origin: string
  readonly url: string
  readonly toolCalls: Array<ModelToolCall>
  readonly toolResults: Array<{ readonly id: string; readonly text: string }>
  readonly toolNames: Array<ReadonlyArray<string>>
  readonly close: () => Promise<void>
}

type Json = Readonly<Record<string, unknown>>

type Reply = { readonly kind: "text"; readonly text: string } | { readonly kind: "tool"; readonly name: string; readonly input: Json }

type Events = ReadonlyArray<readonly [string, Json]>

interface Script {
  readonly trigger: string
  readonly args: Json
  readonly done: string
  readonly other: string
}

interface State {
  readonly toolCalls: StubModel["toolCalls"]
  readonly toolResults: StubModel["toolResults"]
  readonly toolNames: StubModel["toolNames"]
  readonly nextId: (prefix: string) => string
  readonly cells: Map<string, string>
  readonly waits: Map<string, string>
}

interface Turn {
  readonly asked: boolean
  readonly answered: boolean
  readonly searched: boolean
  readonly names: ReadonlyArray<string>
  readonly search: string | undefined
  readonly cell?: string | undefined
}

const records = (value: unknown): ReadonlyArray<Json> =>
  Array.isArray(value) ? value.filter((item): item is Json => typeof item === "object" && item !== null) : []

const partText = (part: Json): string => {
  if (typeof part["text"] === "string") {
    return part["text"]
  }
  return typeof part["content"] === "string" ? part["content"] : ""
}

const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : records(value)
        .map((part) => partText(part))
        .join("")

const isAskForm = (name: string): boolean => name === "forms_ask_form" || /(^|[-_.])askForm$/.test(name)

const readBody = async (req: IncomingMessage): Promise<Json> => {
  const chunks: Array<Buffer> = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  return raw === "" ? {} : (JSON.parse(raw) as Json)
}

const sse = (res: ServerResponse, events: Events): void => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  res.end(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""))
}

const decide = (script: Script, turn: Turn): Reply => {
  if (!turn.asked) {
    return { kind: "text", text: script.other }
  }
  if (turn.answered) {
    return { kind: "text", text: script.done }
  }
  const askForm = turn.names.find((name) => isAskForm(name))
  if (askForm !== undefined) {
    return { kind: "tool", name: askForm, input: script.args }
  }
  if (turn.search !== undefined && !turn.searched) {
    return { kind: "tool", name: turn.search, input: { query: "ask form", max_results: 5 } }
  }
  return { kind: "text", text: `NO_ASK_FORM ${turn.names.join(",")}` }
}

const remember = (state: State, id: string, output: unknown): void => {
  if (state.toolCalls.some((call) => call.id === id) && !state.toolResults.some((item) => item.id === id)) {
    state.toolResults.push({ id, text: text(output) })
  }
}

const qualified = (tool: Json): ReadonlyArray<string> =>
  tool["type"] === "namespace"
    ? records(tool["tools"]).map((inner) => `${String(tool["name"])}.${String(inner["name"])}`)
    : [String(tool["name"])]

const codeModeNames = (input: ReadonlyArray<Json>): ReadonlyArray<string> =>
  input
    .filter((item) => item["type"] === "additional_tools")
    .flatMap((item) => records(item["tools"]))
    .flatMap((tool) => records(tool["tools"]))
    .filter((tool) => tool["name"] === "exec")
    .flatMap((tool) => [...String(tool["description"]).matchAll(/^### `(\w+)`$/gm)].map((match) => `exec.${String(match[1])}`))

const running = /Script running with cell ID (\S+)/

const runningCell = (item: Json | undefined): string | undefined =>
  item !== undefined && (item["type"] === "function_call_output" || item["type"] === "custom_tool_call_output")
    ? running.exec(text(item["output"]))?.[1]
    : undefined

const settleCell = (state: State, callId: string, output: unknown): void => {
  const cell = running.exec(text(output))?.[1]
  const waited = state.waits.get(callId)
  if (cell !== undefined) {
    if (waited === undefined) {
      state.cells.set(cell, callId)
    }
    return
  }
  remember(state, waited === undefined ? callId : (state.cells.get(waited) ?? callId), output)
}

const waitItem = (state: State, cell: string): Json => {
  const id = state.nextId("call")
  state.waits.set(id, cell)
  return {
    type: "function_call",
    id: state.nextId("fc"),
    call_id: id,
    namespace: "functions",
    name: "wait",
    arguments: JSON.stringify({ cell_id: cell }),
    status: "completed"
  }
}

const responsesTurn = (state: State, script: Script, body: Json): Turn => {
  const input = records(body["input"])
  const tools = records(body["tools"])
  const loaded = input.filter((item) => item["type"] === "tool_search_output").flatMap((item) => records(item["tools"]))
  const names = [
    ...[...tools, ...loaded].filter((tool) => typeof tool["name"] === "string").flatMap((tool) => qualified(tool)),
    ...codeModeNames(input)
  ]
  state.toolNames.push(names)
  const outputs = input.filter((entry) => entry["type"] === "function_call_output" || entry["type"] === "custom_tool_call_output")
  for (const item of outputs) {
    settleCell(state, String(item["call_id"]), item["output"])
  }
  const start = input.findLastIndex(
    (item) => item["type"] === "message" && item["role"] === "user" && text(item["content"]).includes(script.trigger)
  )
  const turn = input.slice(start + 1)
  return {
    asked: start >= 0,
    answered: turn.some(
      (item) =>
        (item["type"] === "function_call" && isAskForm(`${String(item["namespace"] ?? "")}.${String(item["name"])}`)) ||
        (item["type"] === "custom_tool_call" && item["name"] === "exec")
    ),
    searched: turn.some((item) => item["type"] === "tool_search_call"),
    names,
    search: tools.some((tool) => tool["type"] === "tool_search") ? "tool_search" : undefined,
    cell: runningCell(input.at(-1))
  }
}

const responseItem = (state: State, reply: Reply): Json => {
  if (reply.kind === "text") {
    return {
      type: "message",
      id: state.nextId("msg"),
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: reply.text, annotations: [] }]
    }
  }
  if (reply.name === "tool_search") {
    return {
      type: "tool_search_call",
      id: state.nextId("ts"),
      call_id: state.nextId("call"),
      execution: "client",
      status: "completed",
      arguments: reply.input
    }
  }
  const dot = reply.name.lastIndexOf(".")
  const id = state.nextId("call")
  state.toolCalls.push({ api: "responses", id, name: reply.name })
  if (reply.name.startsWith("exec.")) {
    const tool = reply.name.slice(dot + 1)
    return {
      type: "custom_tool_call",
      id: state.nextId("ctc"),
      call_id: id,
      namespace: "functions",
      name: "exec",
      input: [
        `const result = await tools.${tool}(${JSON.stringify(reply.input)})`,
        'text(typeof result === "string" ? result : (result?.content ?? []).map((part) => part.text ?? "").join("\\n") || JSON.stringify(result))'
      ].join("\n"),
      status: "completed"
    }
  }
  return {
    type: "function_call",
    id: state.nextId("fc"),
    call_id: id,
    name: dot < 0 ? reply.name : reply.name.slice(dot + 1),
    ...(dot < 0 ? {} : { namespace: reply.name.slice(0, dot) }),
    arguments: JSON.stringify(reply.input),
    status: "completed"
  }
}

const responses = (state: State, script: Script, body: Json, res: ServerResponse): void => {
  const turn = responsesTurn(state, script, body)
  const item = turn.cell === undefined ? responseItem(state, decide(script, turn)) : waitItem(state, turn.cell)
  const base = { id: state.nextId("resp"), object: "response", created_at: 0, model: body["model"], status: "in_progress", output: [] }
  const usage = {
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 }
  }
  sse(res, [
    ["response.created", { type: "response.created", response: base }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item }],
    ["response.completed", { type: "response.completed", response: { ...base, status: "completed", output: [item], usage } }]
  ])
}

const chatTurn = (state: State, script: Script, body: Json): Turn => {
  const history = records(body["messages"])
  const names = records(body["tools"]).flatMap((tool) => {
    const fn = tool["function"]
    return typeof fn === "object" && fn !== null && typeof (fn as Json)["name"] === "string" ? [String((fn as Json)["name"])] : []
  })
  state.toolNames.push(names)
  for (const message of history.filter((entry) => entry["role"] === "tool")) {
    remember(state, String(message["tool_call_id"]), message["content"])
  }
  const start = history.findLastIndex((message) => message["role"] === "user" && text(message["content"]).includes(script.trigger))
  const called = history
    .slice(start + 1)
    .flatMap((message) => records(message["tool_calls"]))
    .map((call) => String((call["function"] as Json | undefined)?.["name"]))
  return {
    asked: start >= 0,
    answered: called.some((name) => isAskForm(name)),
    searched: called.includes("tool_search_tool"),
    names,
    search: names.includes("tool_search_tool") ? "tool_search_tool" : undefined
  }
}

const chat = (state: State, script: Script, body: Json, res: ServerResponse): void => {
  const reply = decide(script, chatTurn(state, script, body))
  const call =
    reply.kind === "tool"
      ? { id: state.nextId("call"), type: "function", function: { name: reply.name, arguments: JSON.stringify(reply.input) } }
      : undefined
  if (call !== undefined && reply.kind === "tool" && isAskForm(reply.name)) {
    state.toolCalls.push({ api: "chat", id: call.id, name: reply.name })
  }
  const message =
    call === undefined
      ? { role: "assistant", content: reply.kind === "text" ? reply.text : "" }
      : { role: "assistant", content: null, tool_calls: [call] }
  const finish = call === undefined ? "stop" : "tool_calls"
  const base = { id: state.nextId("chatcmpl"), created: 0, model: body["model"] }
  if (body["stream"] !== true) {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(
      JSON.stringify({
        ...base,
        object: "chat.completion",
        choices: [{ index: 0, message, finish_reason: finish }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
    )
    return
  }
  const delta = call === undefined ? message : { role: "assistant", tool_calls: [{ index: 0, ...call }] }
  const chunk = (data: Json) => `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", ...data })}\n\n`
  res.writeHead(200, { "content-type": "text/event-stream" })
  res.end(
    chunk({ choices: [{ index: 0, delta, finish_reason: null }] }) +
      chunk({ choices: [{ index: 0, delta: {}, finish_reason: finish }] }) +
      "data: [DONE]\n\n"
  )
}

const handle = async (state: State, script: Script, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const path = (req.url ?? "").split("?")[0] ?? ""
  const body = await readBody(req)
  if (path.endsWith("/responses")) {
    responses(state, script, body, res)
  } else if (path.endsWith("/chat/completions")) {
    chat(state, script, body, res)
  } else {
    res.writeHead(404).end()
  }
}

export const startStubModel = async (trigger: string, args: Json, done = "STUB_MODEL_DONE", other = "ok"): Promise<StubModel> => {
  let sequence = 0
  const state: State = {
    toolCalls: [],
    toolResults: [],
    toolNames: [],
    nextId: (prefix) => `${prefix}_${++sequence}`,
    cells: new Map(),
    waits: new Map()
  }
  const script: Script = { trigger, args, done, other }
  const server = createServer((req, res) => {
    handle(state, script, req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500)
      }
      res.end()
    })
  })
  const { origin, close } = await listenLocally(server)
  return {
    origin,
    url: `${origin}/v1/chat/completions`,
    toolCalls: state.toolCalls,
    toolResults: state.toolResults,
    toolNames: state.toolNames,
    close
  }
}
