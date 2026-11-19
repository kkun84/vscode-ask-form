import { Effect, Layer } from "effect"
import { UserPresence, UserSettings, WaitingIndicator } from "../../mcp/ports.ts"
import { FormHtml } from "../../mcp/server.ts"
import { formHtml } from "../shared/assets.ts"
import { commentPresets } from "../shared/settings.ts"
import { autoReplies, onAutoReply, type WaitingStatus } from "../shared/waiting.ts"

const away = Effect.callback<void>((resume) => {
  const subscription = onAutoReply(() => {
    subscription.dispose()
    resume(Effect.void)
  })
  return Effect.sync(() => subscription.dispose())
})

export const formServices = (waiting: WaitingStatus) =>
  Layer.mergeAll(
    Layer.succeed(WaitingIndicator, WaitingIndicator.of({ update: (count) => Effect.sync(() => waiting.update(count)) })),
    Layer.succeed(UserPresence, UserPresence.of({ unavailable: Effect.sync(autoReplies), away })),
    Layer.succeed(UserSettings, UserSettings.of({ commentPresets: Effect.sync(commentPresets) })),
    Layer.succeed(FormHtml, formHtml)
  )
