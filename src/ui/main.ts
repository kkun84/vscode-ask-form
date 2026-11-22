import "@ui-sdk/web/button"
import "@ui-sdk/web/checkbox"
import "@ui-sdk/web/collapsible"
import "@ui-sdk/web/date-picker"
import "@ui-sdk/web/input"
import "@ui-sdk/web/number-input"
import "@ui-sdk/web/radio"
import "@ui-sdk/web/slider"
import "@ui-sdk/web/token-input"
import "@ui-sdk/web/time-input"
import { FormApp } from "./app.ts"
import { connect } from "./bridge.ts"
import { defineRankingElements } from "./ranking.ts"

defineRankingElements()

const root = document.querySelector<HTMLElement>("#app")

if (root !== null) {
  const app = new FormApp(root)
  const bridge = await connect({
    onToolInput: (args) => app.setInput(args),
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
