export const installPanelBridge = (): void => {
  const api = (
    window as unknown as { readonly acquireVsCodeApi: () => { readonly postMessage: (message: unknown) => void } }
  ).acquireVsCodeApi()
  const origin = window.location.origin
  const target = { postMessage: (message: unknown) => api.postMessage(message), location: { origin } }
  const add = window.addEventListener.bind(window)
  const remove = window.removeEventListener.bind(window)
  const listeners = new WeakMap<EventListenerOrEventListenerObject, EventListener>()
  const wrap = (listener: EventListenerOrEventListenerObject): EventListener => {
    const existing = listeners.get(listener)
    if (existing !== undefined) {
      return existing
    }
    const wrapped: EventListener = (raw) => {
      const event = raw as MessageEvent
      const source = event.source as Window | null
      if (
        event.origin !== origin ||
        source === null ||
        !Array.from({ length: source.length }, (_, index) => source[index]).includes(window)
      ) {
        return
      }
      const forwarded = new Proxy(event, { get: (message, key) => (key === "source" ? target : Reflect.get(message, key, message)) })
      if (typeof listener === "function") {
        listener.call(window, forwarded)
      } else {
        listener.handleEvent(forwarded)
      }
    }
    listeners.set(listener, wrapped)
    return wrapped
  }
  window.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) =>
    add(type, type === "message" ? wrap(listener) : listener, options)
  window.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) =>
    remove(type, type === "message" ? (listeners.get(listener) ?? listener) : listener, options)
  Object.defineProperty(window, "parent", { value: target })
}
