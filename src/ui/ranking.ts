import {
  createChange,
  createReorder,
  createRovingFocus,
  definePrimitive,
  reorderMessage,
  type ReorderDraft,
  type ReorderMessage
} from "@ui-sdk/core"
import { createParts, wrappedButton } from "@ui-sdk/web"

interface RankingOptions {
  readonly value?: ReadonlyArray<string>
  readonly defaultValue?: ReadonlyArray<string>
  readonly onValueChange?: (value: ReadonlyArray<string>) => void
  readonly labels?: Readonly<Record<string, string>>
  readonly announce?: (message: ReorderMessage) => string
}

interface RankingState {
  value: string[]
  moving: ReorderDraft | null
  focused: string | null
}

const ranking = definePrimitive({
  name: "ranking",
  options: { value: "value", defaultValue: "value", onValueChange: "callback", labels: "value", announce: "value" },
  state: (options: RankingOptions): RankingState => ({
    value: [...(options.value ?? options.defaultValue ?? [])],
    moving: null,
    focused: null
  }),
  sync: (options: RankingOptions) => (options.value === undefined ? {} : { value: [...options.value] }),
  api: (context) => {
    const change = createChange(context)
    const roving = createRovingFocus(context, { slot: "handle", key: "focused" })
    const reorder = createReorder(context, {
      slot: "item",
      key: "value",
      draft: "moving",
      set: (value, details) => change("value", value, details),
      label: (key) => context.options().labels?.[key],
      message: (message) => context.options().announce?.(message) ?? reorderMessage(message)
    })
    return { roving, reorder }
  },
  slots: (slot) => ({
    root: slot({}),
    item: slot<{ value: string }>({
      props: { value: "key" },
      attrs: (state, part) => ({
        style: `order: ${part.api.reorder.order(state).indexOf(part.key)}`,
        "data-grabbed": part.api.reorder.moving(state, part.key) ? "" : undefined,
        "data-dragging": part.api.reorder.dragging(state, part.key) ? "" : undefined
      }),
      bind: (el, part) => part.api.reorder.bind(el, part)
    }),
    handle: slot<{ value: string }>({
      props: { value: { kind: "key", from: "item" } },
      attrs: (state, part) => ({
        tabindex: part.api.roving.tabIndex(state, part),
        "aria-pressed": String(part.api.reorder.moving(state, part.key))
      }),
      on: {
        keydown: (event, { el, api, key }) => {
          if (!api.reorder.keydown(event as KeyboardEvent, key)) {
            api.roving.keydown(event as KeyboardEvent, el!)
          }
        },
        pointerdown: (event, { api, key }) => api.reorder.pointerdown(event as PointerEvent, key)
      },
      bind: (el, part) => part.api.roving.bind(el, part)
    })
  })
})

export const defineRankingElements = (): void => {
  if (customElements.get("af-ranking") !== undefined) {
    return
  }
  createParts(ranking, {
    root: { tag: "af-ranking" },
    item: { tag: "af-ranking-item" },
    handle: { tag: "af-ranking-handle", target: wrappedButton, display: "contents" }
  })
}
