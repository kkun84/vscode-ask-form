import { formHtml } from "../shared/assets.ts"
import { installPanelBridge } from "./bridge.ts"

const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';"

export const panelHtml = (): string =>
  formHtml.replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><script>(${installPanelBridge.toString()})()</script>`
  )
