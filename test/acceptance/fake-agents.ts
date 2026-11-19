import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { listenLocally } from "../support/listen.ts"

export interface AgentToolCall {
  readonly api: "messages" | "responses" | "chat"
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

type Reply = { readonly kind: "text"; readonly text: string } | { readonly kind: "tool"; readonly name: string; readonly input: Json }

type Events = ReadonlyArray<readonly [string, Json]>

interface Script {
  readonly trigger: string
  readonly args: Json
  readonly done: string
  readonly other: string
}

interface State {
  readonly toolCalls: FakeAgents["toolCalls"]
  readonly toolResults: FakeAgents["toolResults"]
  readonly toolNames: FakeAgents["toolNames"]
  readonly nextId: (prefix: string) => string
}

interface Turn {
  readonly asked: boolean
  readonly answered: boolean
  readonly searched: boolean
  readonly names: ReadonlyArray<string>
  readonly search: string | undefined
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

const isAskForm = (name: string): boolean => /(^|[-_.])askForm$/.test(name)

const isSearch = (name: string): boolean => /tool_?search/i.test(name)

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

const messageBlocks = (state: State, reply: Reply): Events => {
  if (reply.kind === "text") {
    return [
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply.text } }]
    ]
  }
  const id = state.nextId("toolu")
  if (isAskForm(reply.name)) {
    state.toolCalls.push({ api: "messages", id, name: reply.name })
  }
  return [
    [
      "content_block_start",
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: reply.name, input: {} } }
    ],
    [
      "content_block_delta",
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(reply.input) } }
    ]
  ]
}

const messagesTurn = (state: State, script: Script, body: Json): Turn => {
  const history = records(body["messages"])
  const names = records(body["tools"]).flatMap((tool) => (typeof tool["name"] === "string" ? [tool["name"]] : []))
  state.toolNames.push(names)
  const start = history.findLastIndex((message) => message["role"] === "user" && text(message["content"]).includes(script.trigger))
  const uses = history
    .slice(start + 1)
    .filter((message) => message["role"] === "assistant")
    .flatMap((message) => records(message["content"]))
    .filter((part) => part["type"] === "tool_use")
  for (const result of history.flatMap((message) => records(message["content"])).filter((part) => part["type"] === "tool_result")) {
    remember(state, String(result["tool_use_id"]), result["content"])
  }
  return {
    asked: start >= 0,
    answered: uses.some((use) => isAskForm(String(use["name"]))),
    searched: uses.some((use) => isSearch(String(use["name"]))),
    names,
    search: names.find((name) => isSearch(name))
  }
}

const messages = (state: State, script: Script, body: Json, res: ServerResponse): void => {
  const reply = decide(script, messagesTurn(state, script, body))
  const message = {
    id: state.nextId("msg"),
    type: "message",
    role: "assistant",
    model: body["model"],
    content: [],
    usage: { input_tokens: 1, output_tokens: 1 }
  }
  const stop = reply.kind === "text" ? "end_turn" : "tool_use"
  if (body["stream"] !== true) {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ...message, content: [{ type: "text", text: reply.kind === "text" ? reply.text : "" }], stop_reason: stop }))
    return
  }
  sse(res, [
    ["message_start", { type: "message_start", message: { ...message, stop_reason: null } }],
    ...messageBlocks(state, reply),
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } }],
    ["message_stop", { type: "message_stop" }]
  ])
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

const responsesTurn = (state: State, script: Script, body: Json): Turn => {
  const input = records(body["input"])
  const tools = records(body["tools"])
  const loaded = input.filter((item) => item["type"] === "tool_search_output").flatMap((item) => records(item["tools"]))
  const names = [
    ...[...tools, ...loaded].filter((tool) => typeof tool["name"] === "string").flatMap((tool) => qualified(tool)),
    ...codeModeNames(input)
  ]
  state.toolNames.push(names)
  for (const item of input.filter((entry) => entry["type"] === "function_call_output" || entry["type"] === "custom_tool_call_output")) {
    remember(state, String(item["call_id"]), item["output"])
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
    search: tools.some((tool) => tool["type"] === "tool_search") ? "tool_search" : undefined
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
        '// @exec: {"yield_time_ms": 3600000}',
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
  const item = responseItem(state, decide(script, responsesTurn(state, script, body)))
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
  return { asked: start >= 0, answered: called.some((name) => isAskForm(name)), searched: true, names, search: undefined }
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
    res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: finish }] }))
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
  if (path.endsWith("/messages/count_tokens")) {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 1 }))
  } else if (path.endsWith("/messages")) {
    messages(state, script, body, res)
  } else if (path.endsWith("/responses")) {
    responses(state, script, body, res)
  } else if (path.endsWith("/chat/completions")) {
    chat(state, script, body, res)
  } else {
    res.writeHead(404).end()
  }
}

export const startFakeAgents = async (trigger: string, args: Json, done = "FAKE_AGENT_DONE", other = "ok"): Promise<FakeAgents> => {
  let sequence = 0
  const state: State = { toolCalls: [], toolResults: [], toolNames: [], nextId: (prefix) => `${prefix}_${++sequence}` }
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
  return { origin, toolCalls: state.toolCalls, toolResults: state.toolResults, toolNames: state.toolNames, close }
}
