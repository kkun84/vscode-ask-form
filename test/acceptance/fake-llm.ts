import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { listenLocally } from "../support/listen.ts"

interface ChatMessage {
  readonly role: string
  readonly content?: unknown
  readonly tool_call_id?: string
}

interface ChatTool {
  readonly function?: { readonly name?: string }
}

interface ChatRequest {
  readonly stream?: boolean
  readonly messages?: ReadonlyArray<ChatMessage>
  readonly tools?: ReadonlyArray<ChatTool>
}

export interface FakeLlm {
  readonly url: string
  readonly requests: Array<ChatRequest>
  readonly toolResults: Array<string>
  readonly close: () => Promise<void>
}

type Reply = { readonly kind: "text"; readonly text: string } | { readonly kind: "tool"; readonly name: string; readonly args: string }

const textOf = (content: unknown): string => {
  if (typeof content === "string") {
    return content
  }
  if (Array.isArray(content)) {
    return content.map((part: { readonly text?: unknown }) => (typeof part.text === "string" ? part.text : "")).join("")
  }
  return ""
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Array<Buffer> = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

const completion = (reply: Reply) => ({
  id: "chatcmpl-fake",
  object: "chat.completion",
  created: 0,
  model: "fake-model",
  choices: [
    {
      index: 0,
      message:
        reply.kind === "text"
          ? { role: "assistant", content: reply.text }
          : {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_ask_form", type: "function", function: { name: reply.name, arguments: reply.args } }]
            },
      finish_reason: reply.kind === "text" ? "stop" : "tool_calls"
    }
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
})

const chunk = (delta: Record<string, unknown>, finish: string | null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: "fake-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

const streamed = (reply: Reply): string => {
  const body =
    reply.kind === "text"
      ? chunk({ role: "assistant", content: reply.text }, null) + chunk({}, "stop")
      : chunk(
          {
            role: "assistant",
            tool_calls: [{ index: 0, id: "call_ask_form", type: "function", function: { name: reply.name, arguments: reply.args } }]
          },
          null
        ) + chunk({}, "tool_calls")
  return `${body}data: [DONE]\n\n`
}

export const startFakeLlm = async (trigger: string, args: Readonly<Record<string, unknown>>): Promise<FakeLlm> => {
  const requests: Array<ChatRequest> = []
  const toolResults: Array<string> = []

  const decide = (request: ChatRequest): Reply => {
    const messages = request.messages ?? []
    const toolMessage = messages.findLast((message) => message.role === "tool")
    if (toolMessage !== undefined) {
      toolResults.push(textOf(toolMessage.content))
      return { kind: "text", text: "FAKE_LLM_DONE" }
    }
    const asked = messages.some((message) => message.role === "user" && textOf(message.content).includes(trigger))
    const tool = (request.tools ?? [])
      .map((item) => item.function?.name ?? "")
      .find((name) => name.endsWith("ask_form") && !name.startsWith("forms_"))
    return asked && tool !== undefined ? { kind: "tool", name: tool, args: JSON.stringify(args) } : { kind: "text", text: "ok" }
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const request = JSON.parse((await readBody(req)) || "{}") as ChatRequest
    requests.push(request)
    const reply = decide(request)
    if (request.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream" }).end(streamed(reply))
    } else {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(completion(reply)))
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res)
  })
  const { origin, close } = await listenLocally(server)
  return { url: `${origin}/v1/chat/completions`, requests, toolResults, close }
}
