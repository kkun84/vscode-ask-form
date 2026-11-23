import { createChange, createTransfer, definePrimitive, transferMessage, type TransferDraft, type TransferMessage } from "@ui-sdk/core"
import { createParts } from "@ui-sdk/web"

type Lists = Record<"ranked" | "pool", string[]>

interface RankingOptions {
  readonly lists?: Lists
  readonly max?: number
  readonly all?: ReadonlyArray<string>
  readonly labels?: Readonly<Record<string, string>>
  readonly listLabels?: Readonly<Record<string, string>>
  readonly announce?: (message: TransferMessage) => string
  readonly onListsChange?: (lists: Lists) => void
  readonly render?: (lists: Lists, moving: string | undefined) => void
}

interface RankingState {
  lists: Lists
  moving: TransferDraft | null
}

const ranking = definePrimitive({
  name: "ranking",
  options: {
    lists: "value",
    max: "number",
    all: "value",
    labels: "value",
    listLabels: "value",
    announce: "value",
    onListsChange: "callback",
    render: "value"
  },
  state: (options: RankingOptions): RankingState => ({
    lists: { ranked: [...(options.lists?.ranked ?? [])], pool: [...(options.lists?.pool ?? [])] },
    moving: null
  }),
  sync: (options: RankingOptions) =>
    options.lists === undefined ? {} : { lists: { ranked: [...options.lists.ranked], pool: [...options.lists.pool] } },
  api: (context) => {
    const change = createChange(context)
    const transfer = createTransfer(context, {
      key: "lists",
      draft: "moving",
      set: (value, details) => change("lists", value as Lists, details),
      order: () => ["ranked", "pool"],
      accepts: (key, list) => {
        const max = context.options().max
        const ranked = context.store.get().lists.ranked.filter((item) => item !== key)
        return list !== "ranked" || max === undefined || ranked.length < max
      },
      label: (key) => context.options().labels?.[key],
      listLabel: (list) => context.options().listLabels?.[list],
      message: (message) => context.options().announce?.(message) ?? transferMessage(message)
    })
    const draw = () => {
      const state = context.store.get()
      context.options().render?.(transfer.lists(state) as Lists, state.moving?.key)
    }
    context.onDestroy(context.store.subscribe(draw))
    queueMicrotask(draw)
    const listOf = (key: string): keyof Lists => (context.store.get().lists.ranked.includes(key) ? "ranked" : "pool")
    return {
      transfer,
      listOf,
      append: (key: string) => transfer.move(key, "ranked", context.store.get().lists.ranked.length),
      remove: (key: string) => {
        const all = context.options().all ?? []
        const rank = (value: string) => all.indexOf(value)
        const index = context.store.get().lists.pool.filter((value) => rank(value) < rank(key)).length
        return transfer.move(key, "pool", index)
      }
    }
  },
  slots: (slot) => ({
    root: slot({}),
    list: slot<{ list: string }>({
      props: { list: "string" },
      bind: (el, part) => part.api.transfer.bindList(el, part.props.list)
    }),
    item: slot<{ value: string }>({
      props: { value: "key" },
      attrs: (state, part) => ({
        "data-grabbed": part.api.transfer.moving(state, part.key) ? "" : undefined,
        "data-dragging": part.api.transfer.dragging(state, part.key) ? "" : undefined
      }),
      on: {
        keydown: (event, { api, key }) => {
          const keyboard = event as KeyboardEvent
          if (api.listOf(key) === "ranked" && (keyboard.key === "Delete" || keyboard.key === "Backspace")) {
            keyboard.preventDefault()
            api.remove(key)
            return
          }
          api.transfer.keydown(keyboard, key)
        },
        pointerdown: (event, { api, key }) => {
          if ((event.target as HTMLElement).closest("button") === null) {
            api.transfer.pointerdown(event as PointerEvent, key)
          }
        }
      },
      bind: (el, part) => part.api.transfer.bindItem(el, part.key)
    })
  })
})

export const defineRankingElements = (): void => {
  if (customElements.get("af-ranking") !== undefined) {
    return
  }
  createParts(ranking, {
    root: { tag: "af-ranking", api: ["append", "remove"] },
    list: { tag: "af-ranking-list" },
    item: { tag: "af-ranking-item" }
  })
}
