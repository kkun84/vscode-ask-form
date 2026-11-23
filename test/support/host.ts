import { Effect, Result, Schedule, type Scope } from "effect"
import { createAppHost, type AppHost } from "../../src/core/appHost.ts"
import { outcomeText, type CompiledForm, type Outcome } from "../../src/core/form.ts"
import { formSpecJsonSchema } from "../../src/core/tool.ts"
import { compile } from "../../src/core/validate.ts"

export interface ToolResult {
  readonly isError: boolean
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>
  readonly structuredContent?: Readonly<Record<string, unknown>> | undefined
}

export interface Harness {
  readonly call: (name: "ask_user_form" | "form_answer", args: Record<string, unknown>) => Effect.Effect<ToolResult>
  readonly tool: (name: "ask_user_form") => Effect.Effect<{ readonly inputSchema: unknown }>
  readonly waitUntil: (count: number) => Effect.Effect<void>
}

interface Waiting {
  readonly form: CompiledForm
  readonly host: AppHost
  readonly replies: Map<number, unknown>
}

const textOf = (text: string, isError: boolean, structuredContent?: Readonly<Record<string, unknown>>): ToolResult => ({
  isError,
  content: [{ type: "text", text }],
  structuredContent
})

const harness = (): Harness => {
  const waiting: Array<Waiting> = []
  const asked: Array<Waiting> = []
  let nextId = 1
  const ask = (args: Record<string, unknown>) =>
    Effect.callback<ToolResult>((resume) => {
      const compiled = compile(args)
      if (Result.isFailure(compiled)) {
        resume(Effect.succeed(textOf(compiled.failure.join("\n"), true)))
        return
      }
      const replies = new Map<number, unknown>()
      const entry: Waiting = {
        form: compiled.success,
        replies,
        host: createAppHost({
          form: compiled.success,
          args,
          context: { theme: "dark", locale: "ja" },
          post: (message) => {
            if (typeof message["id"] === "number") {
              replies.set(message["id"], message["result"])
            }
          },
          onOutcome: (outcome: Outcome) => {
            waiting.splice(waiting.indexOf(entry), 1)
            resume(Effect.succeed(textOf(outcomeText(outcome), false, { ...outcome, next: outcomeText(outcome) })))
          }
        })
      }
      waiting.push(entry)
      asked.push(entry)
      return Effect.sync(() => {
        if (waiting.includes(entry)) {
          waiting.splice(waiting.indexOf(entry), 1)
          entry.host.cancel()
        }
      })
    })
  const answer = (args: Record<string, unknown>) =>
    Effect.sync(() => {
      const entry = waiting.find((item) => item.form.key === args["formKey"]) ?? asked.findLast((item) => item.form.key === args["formKey"])
      if (entry === undefined) {
        return textOf("expired: このフォームはもう回答を受け付けていません", true)
      }
      const id = nextId++
      entry.host.receive({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "form_answer", arguments: args } })
      return entry.replies.get(id) as ToolResult
    })
  return {
    call: (name, args) => (name === "ask_user_form" ? ask(args) : answer(args)),
    tool: () => Effect.succeed({ inputSchema: formSpecJsonSchema }),
    waitUntil: (count) =>
      Effect.suspend(() => (waiting.length === count ? Effect.void : Effect.fail("not yet"))).pipe(
        Effect.retry({ times: 500, schedule: Schedule.spaced("5 millis") }),
        Effect.orDie
      )
  }
}

export const withHarness = <A>(body: (h: Harness) => Effect.Effect<A, unknown, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(body(harness())))

export const structured = (result: ToolResult): Record<string, unknown> => ({ ...result.structuredContent })

export const text = (result: ToolResult): string => result.content.map((item) => item.text).join("\n")
