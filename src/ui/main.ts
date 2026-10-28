import { FormApp } from "./app.ts"
import { connect } from "./bridge.ts"

const root = document.querySelector<HTMLElement>("#app")

if (root !== null) {
  const app = new FormApp(root)
  const bridge = await connect({
    onToolInput: (args) => app.setInput(args),
    onToolResult: (result) => app.setResult(result),
    onToolCancelled: () => app.setCancelled(),
    onHostContext: (context) => app.setContext(context)
  })
  app.attach(bridge)
  let last = 0
  new ResizeObserver(() => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height)
    if (height !== last) {
      last = height
      bridge.notifySize(height)
    }
  }).observe(document.documentElement)
}
