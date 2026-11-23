import {
  activeFields,
  answerValues,
  changedFields,
  commentsFor,
  computeValues,
  describeComputed,
  describeValue,
  displayOrder,
  followUpsOf,
  formatNumber,
  heldFields,
  initialValues,
  isMultiple,
  treeAncestors,
  appendPreset,
  commentPresetsFrom,
  maxCommentLength,
  maxNoteLength,
  prepare,
  unansweredFields,
  type Answered,
  type CompiledForm,
  type FieldValue,
  type Values
} from "../core/form.ts"
import { languageOf, messages, type Messages } from "../core/messages.ts"
import type {
  ChoiceField,
  DateField,
  Field,
  FormSpec,
  NumberField,
  NumberRangeField,
  RankingField,
  SearchChoiceField,
  TextField,
  TextListField,
  TimeField,
  TreeChoiceField,
  TreeNode
} from "../core/spec.ts"
import type { Bridge, HostContext, ToolResult } from "./bridge.ts"
import { h, on, uid } from "./dom.ts"
import type { TransferMessage } from "@ui-sdk/core"
import { listControl } from "./list.ts"
import { branchCanvas, drawBranches, gutterFor, type BranchLane } from "./branches.ts"
import type { TreeItemData } from "@ui-sdk/core/tree"

type Action = "submit" | "chat"

type RankingLists = Record<"ranked" | "pool", string[]>

type RankingElement = HTMLElement & {
  lists: RankingLists
  max: number
  all: ReadonlyArray<string>
  labels: Readonly<Record<string, string>>
  listLabels: Readonly<Record<string, string>>
  announce: (message: TransferMessage) => string
  render: (lists: RankingLists) => void
  api?: { readonly append: (key: string) => boolean; readonly remove: (key: string) => boolean }
}

const onValue = <T>(element: HTMLElement, type: "valuechange" | "valuecommit", listener: (value: T, detail: ValueDetail) => void) =>
  element.addEventListener(type, (event) => {
    const detail = (event as CustomEvent<ValueDetail & { readonly value: T }>).detail
    listener(detail.value, detail)
  })

interface ValueDetail {
  readonly reason?: string
  readonly event?: Event
}

const resultText = (result: ToolResult): string => (result.content ?? []).map((item) => item.text ?? "").join("\n")

const recView = (field: Field, title: string, value: string | undefined, action: HTMLElement | null, id: string): HTMLElement =>
  h(
    "div",
    { class: "rec", id },
    h(
      "span",
      { class: "rec-head" },
      h("span", { class: "rec-title" }, title),
      value === undefined ? null : h("span", { class: "rec-value" }, value)
    ),
    field.reason === undefined ? null : h("span", { class: "rec-reason" }, field.reason),
    field.reasonDetails === undefined ? null : h("span", { class: "rec-details" }, field.reasonDetails),
    action
  )

const picks = (field: Field): boolean => field.type === "choice" || field.type === "searchChoice"

const reasoned = (field: Field): boolean => field.reason !== undefined || field.reasonDetails !== undefined

const hasDetails = (field: Field): boolean =>
  (field.default !== undefined && reasoned(field)) ||
  ((field.type === "choice" || field.type === "searchChoice") && field.options.some((option) => option.details !== undefined))

const invalidTargets = [
  ":scope > .q-group af-ranking",
  ":scope > .q-group ui-tree",
  ":scope > .q-group input:not([type=range])",
  ":scope > .q-group textarea",
  ":scope > .q-group ui-radio-group",
  ":scope > .q-group ui-checkbox-group"
].join(", ")

const focusControl = (card: HTMLElement | undefined): void => {
  const control = card?.querySelector<HTMLElement>(
    ":scope > .q-group :is(input, textarea, ui-radio, ui-checkbox, button.grip, ui-tree-item[tabindex='0'])"
  )
  control?.focus()
}

type Bounds = Pick<NumberField, "min" | "max" | "step" | "prefix">

const largeStep = (field: Bounds): number | undefined => {
  const step = field.step ?? (field.max - field.min) / 100
  return Math.max(step, Math.round((field.max - field.min) / 10 / step) * step)
}

const placeRankingItem = (item: HTMLElement, element: HTMLElement, index: number, list: string, action: string): void => {
  if (item.parentElement !== element || element.children[index] !== item) {
    element.insertBefore(item, element.children[index] ?? null)
  }
  item.dataset["list"] = list
  item.querySelector(".rank")!.textContent = list === "ranked" ? String(index + 1) : ""
  item.querySelector<HTMLElement>("button.rank-action")!.setAttribute("aria-label", action)
}

const rankingDrawer =
  (
    items: ReadonlyMap<string, HTMLElement>,
    parts: { readonly ranked: HTMLElement; readonly pool: HTMLElement; readonly empty: HTMLElement; readonly root: HTMLElement },
    labels: Readonly<Record<string, string>>,
    m: Messages
  ) =>
  (lists: RankingLists): void => {
    const { ranked, pool, empty, root } = parts
    const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null
    for (const [name, element] of [
      ["ranked", ranked],
      ["pool", pool]
    ] as const) {
      for (const [index, value] of lists[name].entries()) {
        const item = items.get(value)
        if (item !== undefined) {
          placeRankingItem(
            item,
            element,
            index,
            name,
            name === "ranked" ? m.unrankOf(labels[value] ?? value) : m.rankOf(labels[value] ?? value)
          )
        }
      }
    }
    empty.hidden = lists.ranked.length > 0
    pool.hidden = lists.pool.length === 0
    focused?.focus()
  }

const wireRanking = (items: ReadonlyMap<string, HTMLElement>, root: RankingElement): void => {
  for (const [value, item] of items) {
    on(item.querySelector<HTMLElement>("button.rank-action")!, "click", () => {
      if (item.dataset["list"] === "ranked") {
        root.api?.remove(value)
      } else {
        root.api?.append(value)
      }
    })
    on(item, "click", (event) => {
      if (item.dataset["list"] === "pool" && (event.target as HTMLElement).closest("button") === null) {
        root.api?.append(value)
      }
    })
  }
}

const numberInput = (
  field: Bounds,
  label: string,
  input: HTMLInputElement,
  value: number | undefined,
  m: Messages
): HTMLElementTagNameMap["ui-number-input"] =>
  h(
    "ui-number-input",
    { min: field.min, max: field.max, step: field.step, "large-step": largeStep(field), wheel: true, "default-value": value },
    h(
      "ui-number-input-group",
      { class: "stepper" },
      h(
        "ui-number-input-scrub-area",
        { class: "scrub", title: m.scrub, "pixels-per-step": 4 },
        h("span", { "aria-hidden": "true" }, field.prefix ?? "⇔")
      ),
      h("ui-number-input-decrement", {}, h("button", { type: "button", class: "step", "aria-label": m.decrease(label) }, "−")),
      h("ui-number-input-control", {}, input),
      h("ui-number-input-increment", {}, h("button", { type: "button", class: "step", "aria-label": m.increase(label) }, "+"))
    )
  )

const rangeParts = (
  field: NumberRangeField,
  labelId: string,
  describedBy: string,
  pair: readonly [number, number] | undefined,
  m: Messages
) => {
  const names = [m.lowerOf(field.label), m.upperOf(field.label)] as const
  const slider = h(
    "ui-slider",
    {
      min: field.min,
      max: field.max,
      step: field.step,
      "large-step": largeStep(field),
      "default-value": (pair ?? [field.min, field.max]).join("/"),
      "aria-labelledby": labelId,
      class: pair === undefined ? "unset" : undefined
    },
    h(
      "ui-slider-control",
      {},
      h(
        "ui-slider-track",
        {},
        h("ui-slider-indicator"),
        names.map((name) => h("ui-slider-thumb", { "aria-label": name, "aria-describedby": describedBy }))
      )
    )
  )
  const inputs = names.map((name) =>
    h("input", {
      class: "exact",
      inputmode: "decimal",
      role: "spinbutton",
      "aria-valuemin": field.min,
      "aria-valuemax": field.max,
      "aria-label": [name, field.prefix, field.suffix].filter((part) => part !== undefined).join(" "),
      "aria-describedby": describedBy
    })
  )
  const fields = inputs.map((input, index) => numberInput(field, names[index === 0 ? 0 : 1], input, pair?.[index], m))
  return { slider, inputs, fields }
}

const treeData = (nodes: ReadonlyArray<TreeNode>): Array<TreeItemData> =>
  nodes.map((node) => ({
    value: node.value,
    label: node.label,
    ...(node.children === undefined ? {} : { children: treeData(node.children) })
  }))

interface TreeRow {
  readonly row: HTMLElement
  readonly ancestors: ReadonlyArray<string>
}

const treeRow = (node: TreeNode, multiple: boolean, parent: string | undefined): HTMLElement =>
  h(
    "ui-tree-item",
    { value: node.value, parent, branch: node.children !== undefined },
    h(
      "ui-tree-item-label",
      {},
      node.children === undefined
        ? h("span", { class: "tree-leaf", "aria-hidden": "true" })
        : h("ui-tree-item-indicator", { "aria-hidden": "true" }),
      multiple ? h("ui-tree-item-checkbox") : null,
      h(
        "span",
        { class: "tree-text" },
        h("span", { class: "tree-label" }, node.label),
        node.description === undefined ? null : h("span", { class: "option-summary" }, node.description)
      )
    )
  )

const treeRows = (nodes: ReadonlyArray<TreeNode>, multiple: boolean, ancestors: ReadonlyArray<string> = []): ReadonlyArray<TreeRow> =>
  nodes.flatMap((node) => [
    { row: treeRow(node, multiple, ancestors.at(-1)), ancestors },
    ...treeRows(node.children ?? [], multiple, [...ancestors, node.value])
  ])

const foldTreeRows = (tree: HTMLElement, rows: ReadonlyArray<TreeRow>): void => {
  const expanded = new Set([...tree.querySelectorAll("ui-tree-item[aria-expanded='true']")].map((item) => item.getAttribute("value")))
  for (const { row, ancestors } of rows) {
    row.hidden = !ancestors.every((ancestor) => expanded.has(ancestor))
  }
}

const choiceControl = (multiple: boolean, value: string, labelledBy: string, describedBy: ReadonlyArray<string | undefined>): HTMLElement =>
  h(
    multiple ? "ui-checkbox" : "ui-radio",
    {
      value,
      "aria-labelledby": labelledBy,
      "aria-describedby": describedBy.filter((id) => id !== undefined && id !== "").join(" ")
    },
    h(multiple ? "ui-checkbox-indicator" : "ui-radio-indicator", { "aria-hidden": "true" })
  )

const calendarIcon = (): HTMLElement => {
  const element = h("span", { "aria-hidden": "true", class: "calendar-icon" })
  element.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" focusable="false"><path fill="currentColor" d="M5 1h1v2h4V1h1v2h2.5A1.5 1.5 0 0 1 15 4.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-9A1.5 1.5 0 0 1 2.5 3H5V1ZM2 7v6.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V7H2Zm0-1h12V4.5a.5.5 0 0 0-.5-.5h-11a.5.5 0 0 0-.5.5V6Z"/></svg>'
  return element
}

const plainCalendarText = (content: HTMLElement): void => {
  for (const day of content.querySelectorAll("ui-calendar-day")) {
    const digits = (day.textContent ?? "").replaceAll(/\D+/g, "")
    if (digits !== "" && day.textContent !== digits) {
      day.textContent = digits
    }
  }
  const heading = content.querySelector("ui-calendar-heading")
  const parts = /^(\d+)年(\d+)月$/.exec(heading?.textContent ?? "")
  if (heading !== null && parts !== null) {
    heading.textContent = `${parts[1]}/${(parts[2] ?? "").padStart(2, "0")}`
  }
}

const clockMinutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))

const snapTime = (value: string, field: TimeField): string => {
  if (field.step === undefined) {
    return value
  }
  const min = field.min === undefined ? 0 : clockMinutes(field.min)
  const max = field.max === undefined ? 24 * 60 - 1 : clockMinutes(field.max)
  const steps = Math.min(Math.floor((max - min) / field.step), Math.max(0, Math.round((clockMinutes(value) - min) / field.step)))
  const fitted = min + steps * field.step
  return `${String(Math.floor(fitted / 60)).padStart(2, "0")}:${String(fitted % 60).padStart(2, "0")}`
}

const collapsible = (name: string, open: boolean, label: string, ...content: ReadonlyArray<HTMLElement>): HTMLElement =>
  h(
    "ui-collapsible",
    { class: name, "default-open": open },
    h("ui-collapsible-trigger", {}, h("button", { type: "button", class: "summary" }, label)),
    h("ui-collapsible-panel", { "keep-mounted": true }, ...content)
  )

const markInvalid = (card: HTMLElement, invalid: boolean): void => {
  card.classList.toggle("missing", invalid)
  for (const input of card.querySelectorAll(invalidTargets)) {
    if (input.closest(".q") === card) {
      if (invalid) {
        input.setAttribute("aria-invalid", "true")
      } else {
        input.removeAttribute("aria-invalid")
      }
    }
  }
}

const describeVisible = (card: HTMLElement, folded: boolean): void => {
  for (const input of card.querySelectorAll<HTMLElement>("[aria-describedby]")) {
    if (input.closest(".q") !== card) {
      continue
    }
    input.dataset["describedby"] ??= input.getAttribute("aria-describedby") ?? ""
    const ids = input.dataset["describedby"].split(" ").filter((id) => {
      const target = id === "" ? null : card.ownerDocument.querySelector(`#${CSS.escape(id)}`)
      return target !== null && !target.matches(".rec[hidden]") && !(folded && target.matches(".option-details, .rec"))
    })
    input.setAttribute("aria-describedby", ids.join(" "))
  }
}

const optionRow = (
  input: HTMLElement,
  option: ChoiceField["options"][number],
  ids: readonly [string, string, string, string],
  badge: string | undefined,
  why: HTMLElement | null
): HTMLElement =>
  h(
    "label",
    { class: "option" },
    input,
    h(
      "span",
      { class: "option-text" },
      h("span", { class: "option-head", id: ids[0] }, option.label, badge === undefined ? null : h("span", { class: "badge" }, badge)),
      option.description === undefined ? null : h("span", { class: "option-summary", id: ids[1] }, option.description),
      option.details === undefined ? null : h("span", { class: "option-details", id: ids[2] }, option.details),
      why
    )
  )

const affix = (content: string | undefined): HTMLElement | null => (content === undefined ? null : h("span", { class: "muted" }, content))

const commentIcon =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M2.5 2h11A1.5 1.5 0 0 1 15 3.5v7a1.5 1.5 0 0 1-1.5 1.5H8.2l-3.4 2.7A.5.5 0 0 1 4 14.3V12H2.5A1.5 1.5 0 0 1 1 10.5v-7A1.5 1.5 0 0 1 2.5 2Zm0 1a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5H5v2.2L7.9 11h5.6a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-11Z"/></svg>'

const icon = (): HTMLElement => {
  const element = h("span", { class: "comment-icon", "aria-hidden": "true" })
  element.innerHTML = commentIcon
  return element
}

export class FormApp {
  private m: Messages = messages("en")
  private form: CompiledForm | undefined
  private values: Record<string, FieldValue> = {}
  private comments: Record<string, string> = {}
  private readonly commenting = new Set<string>()
  private presets: ReadonlyArray<string> | undefined
  private initial: Values = {}
  private note = ""
  private noteOpen = false
  private busy = false
  private error: string | undefined
  private bridge: Bridge | undefined
  private readonly live = {
    cards: [] as Array<{
      readonly field: Field
      readonly element: HTMLElement
      readonly toggle: HTMLElement | null
      readonly answer: HTMLElement
      readonly back: HTMLElement | null
      readonly rec: HTMLElement | null
      readonly comment: HTMLElement
      readonly open: HTMLElement
    }>,
    computed: undefined as HTMLElement | undefined,
    status: undefined as HTMLElement | undefined,
    remaining: undefined as HTMLButtonElement | undefined,
    primary: undefined as HTMLButtonElement | undefined,
    form: undefined as HTMLElement | undefined,
    setters: new Map<string, (value: FieldValue) => void>(),
    unselects: new Map<string, HTMLElement>(),
    pickedLists: new Map<string, { readonly element: HTMLElement; readonly field: SearchChoiceField }>(),
    resets: new Map<string, { readonly element: HTMLElement; readonly changed: () => boolean }>(),
    fields: undefined as HTMLElement | undefined,
    canvas: undefined as SVGElement | undefined,
    optionRows: new Map<string, Map<string, { readonly row: HTMLElement; readonly control: HTMLElement }>>(),
    reveals: new Map<string, { readonly chip: HTMLElement; readonly reason: HTMLElement }>()
  }
  private followUps: ReadonlyMap<string, ReadonlyArray<Field>> = new Map()
  private hot: string | undefined
  private jumped: string | undefined
  private readonly resized = new ResizeObserver(() => this.drawBranches())
  private readonly folded = new Set<string>()
  private showMissing = false
  private keepFocus = false

  private readonly root: HTMLElement

  constructor(root: HTMLElement) {
    this.root = root
    this.render()
    void document.fonts.ready.then(() => this.drawBranches())
  }

  attach(bridge: Bridge): void {
    this.bridge = bridge
    void this.loadSettings(bridge)
  }

  private async loadSettings(bridge: Bridge): Promise<void> {
    try {
      const result = await bridge.callTool("form_settings", {})
      this.presets = result.isError === true ? undefined : commentPresetsFrom(result.structuredContent?.["commentPresets"])
    } catch {
      return
    }
    if (this.presets !== undefined) {
      this.render()
    }
  }

  setContext(context: HostContext): void {
    if (context.locale !== undefined) {
      this.m = messages(languageOf(context.locale))
      document.documentElement.lang = languageOf(context.locale)
    }
    if (context.theme !== undefined) {
      document.documentElement.dataset["theme"] = context.theme
    }
    for (const [name, value] of Object.entries(context.styles?.variables ?? {})) {
      document.documentElement.style.setProperty(name, value)
    }
    this.render()
  }

  setInput(args: Readonly<Record<string, unknown>>): void {
    let form: CompiledForm
    try {
      form = prepare(args as unknown as FormSpec, args)
      initialValues(form.spec)
    } catch {
      return
    }
    this.form = form
    this.initial = initialValues(form.spec)
    this.values = { ...this.initial }
    this.note = ""
    this.noteOpen = false
    this.comments = {}
    this.jumped = undefined
    this.commenting.clear()
    this.folded.clear()
    this.showMissing = false
    this.render()
  }

  private async whileBusy(task: (bridge: Bridge) => Promise<void>): Promise<void> {
    if (this.bridge === undefined || this.busy) {
      return
    }
    this.keepFocus = this.root.contains(document.activeElement)
    this.busy = true
    this.error = undefined
    this.refresh()
    try {
      await task(this.bridge)
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
      this.render()
    }
  }

  private blockUnanswered(form: CompiledForm): boolean {
    const unanswered = unansweredFields(form.spec, this.current(), this.commented())
    if (unanswered.length === 0) {
      return false
    }
    this.error = this.m.unanswered(unanswered.map((field) => field.label))
    this.showMissing = true
    this.refresh()
    const first = this.live.cards.find((card) => card.field.id === unanswered[0]?.id)
    focusControl(first?.element)
    return true
  }

  private answer(action: Action): Promise<void> {
    const form = this.form
    if (form === undefined) {
      return Promise.resolve()
    }
    const answered = this.answeredNow()
    if (action === "submit" && this.blockUnanswered(form)) {
      return Promise.resolve()
    }
    return this.whileBusy(async (bridge) => {
      const result = await bridge.callTool("form_answer", {
        formKey: form.key,
        action,
        ...(action === "submit"
          ? {
              values: answered.values,
              held: heldFields(form.spec, answered.values),
              comments: answered.comments,
              note: this.note
            }
          : {})
      })
      if (result.isError === true) {
        this.error = resultText(result)
      }
    })
  }

  private answeredNow(): Answered {
    const form = this.form
    if (form === undefined) {
      return { values: this.values }
    }
    const values = answerValues(form.spec, this.current())
    return { values, comments: commentsFor(form.spec, values, this.comments) }
  }

  private commented(): ReadonlySet<string> {
    return new Set(Object.keys(this.form === undefined ? {} : commentsFor(this.form.spec, this.values, this.comments)))
  }

  private current(): Values {
    return this.values
  }

  private unset(id: string): void {
    delete this.values[id]
    this.error = undefined
    this.refresh()
  }

  private setValue(id: string, value: FieldValue): void {
    this.values[id] = value
    this.error = undefined
    this.refresh()
  }

  private commentView(field: Field): { readonly open: HTMLElement; readonly box: HTMLElement } {
    const input = h("textarea", {
      rows: 2,
      maxlength: maxCommentLength,
      class: "comment-input",
      "aria-label": this.m.commentOf(field.label)
    })
    input.value = this.comments[field.id] ?? ""
    on(input, "input", () => {
      this.comments[field.id] = input.value
      this.refresh()
    })
    const open = h("button", {
      type: "button",
      class: "head-action comment-open",
      title: this.m.commentOf(field.label),
      "aria-label": this.m.commentOf(field.label),
      "aria-expanded": "false"
    })
    open.innerHTML = commentIcon
    on(open, "click", () => {
      if (this.commenting.has(field.id)) {
        this.commenting.delete(field.id)
        this.refresh()
        return
      }
      this.commenting.add(field.id)
      this.refresh()
      input.focus()
    })
    const presets = (this.presets ?? this.m.commentPresets).map((preset) =>
      on(h("button", { type: "button", class: "preset" }, preset), "click", () => {
        input.value = appendPreset(input.value, preset)
        input.dispatchEvent(new Event("input"))
        input.focus()
      })
    )
    return {
      open,
      box: h(
        "div",
        { class: "q-comment" },
        h("div", { class: "comment-head", "aria-hidden": "true" }, icon(), h("span", {}, this.m.comment)),
        input,
        presets.length === 0 ? null : h("div", { class: "presets", role: "group", "aria-label": this.m.presetsOf(field.label) }, presets)
      )
    }
  }

  private render(): void {
    this.live.cards.length = 0
    this.live.setters.clear()
    this.live.unselects.clear()
    this.live.pickedLists.clear()
    this.live.resets.clear()
    this.live.computed = undefined
    this.live.status = undefined
    this.live.remaining = undefined
    this.live.primary = undefined
    this.live.form = undefined
    this.live.fields = undefined
    this.live.canvas = undefined
    this.live.optionRows.clear()
    this.live.reveals.clear()
    this.resized.disconnect()
    const hadFocus = this.keepFocus || this.root.contains(document.activeElement)
    this.keepFocus = false
    this.root.classList.remove("motion")
    this.root.replaceChildren(this.formView())
    if (hadFocus) {
      this.root.querySelector<HTMLElement>("[data-focus]")?.focus()
    }
    requestAnimationFrame(() => this.root.classList.add("motion"))
    this.applyFolds()
    this.refresh()
  }

  private formView(): HTMLElement {
    const form = this.form
    if (form === undefined) {
      return h("p", { class: "notice", role: "status" }, this.m.waiting)
    }
    const spec = form.spec
    this.followUps = followUpsOf(spec)
    const titleId = uid("title")
    const element = h(
      "form",
      { class: "card", "aria-labelledby": titleId, novalidate: true },
      h(
        "header",
        { class: "head" },
        h("h1", { id: titleId, tabindex: -1, "data-focus": true }, spec.title),
        spec.description === undefined ? null : h("p", { class: "description" }, spec.description)
      ),
      this.fieldsView(spec),
      (spec.computed ?? []).length === 0 ? null : this.computedView(),
      this.noteView(),
      this.answerFooter()
    )
    this.live.form = element
    on(element, "submit", (event) => {
      event.preventDefault()
    })
    on(element, "keydown", (event) => {
      if (event.isComposing) {
        return
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        event.target?.dispatchEvent(new Event("change"))
        void this.answer("submit")
      }
    })
    return element
  }

  private fieldsView(spec: FormSpec): HTMLElement {
    const element = h(
      "div",
      { class: "fields" },
      displayOrder(spec).map((field) => this.card(field))
    )
    this.live.fields = element
    const sources = [...this.followUps.keys()].map((id) => this.depthOf(id))
    if (sources.length > 0) {
      this.live.canvas = branchCanvas()
      element.classList.add("branching")
      element.style.setProperty("--branch-gutter", `${gutterFor(Math.max(...sources))}px`)
      element.append(this.live.canvas)
    }
    this.resized.observe(element)
    for (const card of element.querySelectorAll(":scope > .q")) {
      this.resized.observe(card)
    }
    return element
  }

  private depthOf(id: string): number {
    const field = this.form?.spec.fields.find((item) => item.id === id)
    return field?.when === undefined ? 0 : 1 + this.depthOf(field.when.field)
  }

  private sourceOf(field: Field): ChoiceField | SearchChoiceField | undefined {
    const source = this.form?.spec.fields.find((item) => item.id === field.when?.field)
    return source?.type === "choice" || source?.type === "searchChoice" ? source : undefined
  }

  private revealView(field: Field, element: HTMLElement): HTMLElement | null {
    if (field.when === undefined) {
      return null
    }
    const chip = h("span", { class: "reveal-chip", "aria-hidden": "true" })
    const reason = h("span", { class: "visually-hidden", id: uid("reason") })
    this.live.reveals.set(field.id, { chip, reason })
    element.setAttribute("aria-describedby", [element.getAttribute("aria-describedby"), reason.id].filter((id) => id !== null).join(" "))
    element.append(reason)
    const enter = () => {
      this.hot = field.id
      this.drawBranches()
    }
    const leave = () => {
      if (this.hot === field.id && !element.matches(":hover") && !element.contains(document.activeElement)) {
        this.hot = undefined
        this.drawBranches()
      }
    }
    on(element, "mouseenter", enter)
    on(element, "focusin", enter)
    on(element, "mouseleave", leave)
    on(element, "focusout", () => requestAnimationFrame(leave))
    return chip
  }

  private card(field: Field): HTMLElement {
    const labelId = uid("label")
    const descId = field.description === undefined ? undefined : uid("desc")
    const groupId = uid("group")
    const answer = h("span", { class: "q-answer", id: uid("answer") })
    const comment = this.commentView(field)
    const toggle = hasDetails(field)
      ? h(
          "button",
          { type: "button", class: "fold", "aria-label": this.m.detailsOf(field.label), "aria-controls": groupId },
          this.m.details
        )
      : null
    const back = picks(field) ? null : h("button", { type: "button", class: "link", hidden: true }, this.m.backToRecommended)
    const recommended = this.initialText(field)
    const rec = picks(field) || recommended === undefined ? null : recView(field, this.m.recommended, recommended, back, uid("rec"))
    const control = this.control(field, labelId, [answer.id, rec?.id].filter((id) => id !== undefined && id !== "").join(" "))
    const unselect = this.live.unselects.get(field.id) ?? null
    const element = h(
      "div",
      { class: "q", role: "group", "aria-labelledby": labelId, "aria-describedby": descId },
      h(
        "div",
        { class: "q-head" },
        h("span", { class: "q-label", id: labelId }, field.label),
        h("span", { class: "q-actions" }, answer, unselect, toggle, comment.open)
      ),
      field.description === undefined ? null : h("p", { class: "q-desc", id: descId }, field.description),
      h("div", { class: picks(field) ? "q-group choices" : "q-group", id: groupId }, control, rec),
      comment.box
    )
    const chip = this.revealView(field, element)
    const label = element.querySelector(".q-label")
    if (chip !== null && label !== null) {
      const title = h("span", { class: "q-title" })
      label.replaceWith(title)
      title.append(label, chip)
    }
    this.live.cards.push({ field, element, toggle, answer, back, rec, comment: comment.box, open: comment.open })
    if (back !== null) {
      on(back, "click", () => {
        this.live.setters.get(field.id)?.(this.initial[field.id] as FieldValue)
        focusControl(element)
      })
    }
    if (toggle !== null) {
      on(toggle, "click", () => this.setFolded(field.id, !this.folded.has(field.id)))
    }
    return element
  }

  private control(field: Field, labelId: string, describedBy: string): HTMLElement {
    switch (field.type) {
      case "text":
        return this.textView(field, labelId, describedBy)
      case "number":
        return this.numberView(field, labelId, describedBy)
      case "choice":
        return this.choiceView(field, labelId, describedBy)
      case "searchChoice":
        return this.searchChoiceView(field, labelId, describedBy)
      case "ranking":
        return this.rankingView(field, labelId, describedBy)
      case "numberRange":
        return this.rangeView(field, labelId, describedBy)
      case "textList":
        return this.listView(field, labelId, describedBy)
      case "date":
        return this.dateView(field, labelId, describedBy)
      case "time":
        return this.timeView(field, labelId, describedBy)
      case "treeChoice":
        return this.treeView(field, labelId, describedBy)
    }
  }

  private rangeView(field: NumberRangeField, labelId: string, describedBy: string): HTMLElement {
    const current = this.values[field.id]
    let pair: readonly [number, number] | undefined = Array.isArray(current) ? [Number(current[0]), Number(current[1])] : undefined
    const text = (next: number) => `${field.prefix ?? ""}${formatNumber(next)}${field.suffix ?? ""}`
    const { slider, inputs, fields } = rangeParts(field, labelId, describedBy, pair, this.m)
    const spoken = () => {
      slider.format = (next: number) => (pair === undefined ? this.m.notAnswered : text(next))
      for (const [index, input] of inputs.entries()) {
        const bound = pair?.[index]
        if (bound === undefined) {
          input.removeAttribute("aria-valuenow")
          input.setAttribute("aria-valuetext", this.m.notAnswered)
        } else {
          input.setAttribute("aria-valuenow", String(bound))
          input.setAttribute("aria-valuetext", text(bound))
        }
      }
    }
    spoken()
    const apply = (next: readonly [number, number], from: "slider" | "input") => {
      pair = next
      slider.classList.remove("unset")
      if (from === "input") {
        slider.value = [...next]
      }
      for (const [index, item] of fields.entries()) {
        const bound = next[index === 0 ? 0 : 1]
        if (item.value !== bound) {
          item.value = bound
        }
      }
      spoken()
      this.setValue(field.id, next)
    }
    const clamp = (next: number) => Math.min(field.max, Math.max(field.min, next))
    const withBound = (index: number, next: number): readonly [number, number] => {
      const base = pair ?? [field.min, field.max]
      const bound = clamp(next)
      return index === 0 ? [Math.min(bound, base[1]), base[1]] : [base[0], Math.max(bound, base[0])]
    }
    onValue<ReadonlyArray<number>>(slider, "valuechange", (next) => apply([Number(next[0]), Number(next[1])], "slider"))
    fields.forEach((item, index) => {
      onValue<number | null>(item, "valuecommit", (next) => {
        if (next === null) {
          pair = undefined
          slider.classList.add("unset")
          spoken()
          this.unset(field.id)
        } else {
          apply(withBound(index, next), "input")
        }
      })
    })
    this.live.setters.set(field.id, (next) => {
      if (Array.isArray(next)) {
        apply([Number(next[0]), Number(next[1])], "input")
      }
    })
    return h(
      "div",
      { class: "range" },
      slider,
      h(
        "div",
        { class: "row range-inputs" },
        fields[0],
        h("span", { class: "muted" }, this.m.rangeSeparator.trim()),
        fields[1],
        affix(field.suffix)
      )
    )
  }

  private rankingView(field: RankingField, labelId: string, describedBy: string): HTMLElement {
    const hintId = uid("hint")
    const labels = Object.fromEntries(field.options.map((option) => [option.value, option.label]))
    const all = field.options.map((option) => option.value)
    const split = (ranked: ReadonlyArray<string>) => ({ ranked: [...ranked], pool: all.filter((value) => !ranked.includes(value)) })
    const current = this.values[field.id]
    const min = field.min ?? 1
    const items = new Map(field.options.map((option) => [option.value, this.rankingItem(option, hintId, describedBy)] as const))
    const ranked = h("af-ranking-list", { list: "ranked", class: "ranked", role: "list", "aria-label": this.m.rankedOf(field.label) })
    const pool = h("af-ranking-list", { list: "pool", class: "pool", role: "list", "aria-label": this.m.poolOf(field.label) })
    const empty = h("p", { class: "ranking-empty", "aria-hidden": "true" }, this.m.rankEmpty)
    const root = h("af-ranking", { class: "ranking", "aria-labelledby": labelId }, ranked, empty, pool) as RankingElement
    const draw = rankingDrawer(items, { ranked, pool, empty, root }, labels, this.m)
    Object.assign(root, {
      labels,
      listLabels: { ranked: this.m.rankedOf(field.label), pool: this.m.poolOf(field.label) },
      max: field.max ?? all.length,
      all,
      announce: (message: TransferMessage) => this.m.transferMessage(message),
      render: draw
    })
    let rankedNow: ReadonlyArray<string> = Array.isArray(current) ? current : []
    const apply = (next: ReadonlyArray<string>) => {
      rankedNow = next
      if (next.length >= min) {
        this.setValue(field.id, [...next])
      } else {
        this.unset(field.id)
      }
    }
    root.lists = split(Array.isArray(current) ? current : [])
    root.addEventListener("listschange", (event) => {
      const lists = (event as CustomEvent<{ readonly value: RankingLists }>).detail.value
      root.lists = lists
      apply(lists.ranked)
    })
    wireRanking(items, root)
    this.live.setters.set(field.id, (next) => {
      const lists = split(Array.isArray(next) ? next : [])
      root.lists = lists
      draw(lists)
      apply(lists.ranked)
    })
    const reset = on(h("button", { type: "button", class: "link reset" }, this.m.reset), "click", () => {
      this.live.setters.get(field.id)?.(field.default ?? [])
    })
    const initial = field.default ?? []
    this.live.resets.set(field.id, {
      element: reset,
      changed: () => rankedNow.length !== initial.length || rankedNow.some((value, index) => value !== initial[index])
    })
    return h(
      "div",
      { class: "ranking-box" },
      root,
      h("p", { id: hintId, hidden: true }, this.m.rankingHint),
      field.default === undefined ? reset : null
    )
  }

  private rankingItem(option: RankingField["options"][number], hintId: string, describedBy: string): HTMLElement {
    const headId = uid("option")
    return h(
      "af-ranking-item",
      {
        value: option.value,
        role: "listitem",
        tabindex: 0,
        "aria-labelledby": headId,
        "aria-describedby": [hintId, describedBy].join(" ").trim()
      },
      h("span", { class: "rank", "aria-hidden": "true" }),
      h(
        "span",
        { class: "option-text" },
        h("span", { class: "option-head", id: headId }, option.label),
        option.description === undefined ? null : h("span", { class: "option-summary" }, option.description),
        option.details === undefined ? null : h("span", { class: "option-details" }, option.details)
      ),
      h("button", { type: "button", class: "rank-action", tabindex: -1 })
    )
  }

  private listView(field: TextListField, labelId: string, describedBy: string): HTMLElement {
    const current = this.values[field.id]
    const control = listControl({
      items: Array.isArray(current) ? current : [],
      labelId,
      describedBy,
      placeholder: field.placeholder,
      m: this.m,
      onChange: (items) => this.setValue(field.id, [...items])
    })
    this.live.setters.set(field.id, (next) => control.set(Array.isArray(next) ? next : []))
    return control.element
  }

  private dateView(field: DateField, labelId: string, describedBy: string): HTMLElement {
    const current = this.values[field.id]
    const input = h("input", { class: "date-text", "aria-labelledby": labelId, "aria-describedby": describedBy, autocomplete: "off" })
    const content = h("ui-date-picker-content", { hidden: true, class: "calendar-popup" })
    const picker = h(
      "ui-date-picker",
      {
        class: "date-picker",
        min: field.min,
        max: field.max,
        locale: this.m.locale,
        "default-value": typeof current === "string" ? current : undefined,
        "close-on-select": true
      },
      h("ui-date-picker-input", {}, input),
      h(
        "ui-date-picker-trigger",
        {},
        h("button", { type: "button", class: "step calendar", "aria-label": this.m.openCalendar(field.label) }, calendarIcon())
      ),
      content
    )
    new MutationObserver(() => plainCalendarText(content)).observe(content, { subtree: true, childList: true, characterData: true })
    picker.addEventListener("valuechange", (event) => {
      const next = (event as CustomEvent<{ readonly value: unknown }>).detail.value
      if (typeof next === "string") {
        this.setValue(field.id, next)
      } else {
        this.unset(field.id)
      }
    })
    this.live.setters.set(field.id, (next) => {
      ;(picker as HTMLElement & { value: string | null }).value = String(next)
      this.setValue(field.id, String(next))
    })
    return picker
  }

  private timeView(field: TimeField, labelId: string, describedBy: string): HTMLElement {
    const current = this.values[field.id]
    const time = h("ui-time-input", {
      class: "time-input",
      min: field.min,
      max: field.max,
      "hour-cycle": 24,
      locale: this.m.locale,
      "default-value": typeof current === "string" ? current : undefined,
      "aria-labelledby": labelId,
      "aria-describedby": describedBy
    }) as HTMLElement & { value: string | null }
    time.addEventListener("valuechange", (event) => {
      const next = (event as CustomEvent<{ readonly value: unknown }>).detail.value
      if (typeof next !== "string") {
        this.unset(field.id)
        return
      }
      const snapped = snapTime(next.slice(0, 5), field)
      if (snapped !== next.slice(0, 5)) {
        queueMicrotask(() => {
          time.value = snapped
        })
      }
      this.setValue(field.id, snapped)
    })
    this.live.setters.set(field.id, (next) => {
      time.value = String(next)
      this.setValue(field.id, String(next))
    })
    return time
  }

  private treeView(field: TreeChoiceField, labelId: string, describedBy: string): HTMLElement {
    const multiple = isMultiple(field)
    const current = this.values[field.id]
    const selected = Array.isArray(current) ? [...current] : typeof current === "string" ? [current] : []
    const tree = h("ui-tree", {
      class: "tree",
      "aria-labelledby": labelId,
      "aria-describedby": describedBy === "" ? undefined : describedBy,
      "expand-on-press": "false"
    })
    const rows = treeRows(field.nodes, multiple)
    tree.append(...rows.map(({ row }) => row))
    foldTreeRows(tree, rows)
    new MutationObserver(() => foldTreeRows(tree, rows)).observe(tree, { subtree: true, attributeFilter: ["aria-expanded"] })
    tree.items = treeData(field.nodes)
    tree.defaultExpanded = [...treeAncestors(field.nodes, selected)]
    if (multiple) {
      tree.mode = "none"
      tree.checkable = true
      tree.checkStrategy = "trunk"
      tree.defaultChecked = selected
      tree.addEventListener("checkedchange", (event) => {
        this.setValue(field.id, [...(event as CustomEvent<{ readonly value: ReadonlyArray<string> }>).detail.value])
      })
      tree.addEventListener("action", (event) => {
        const { value } = (event as CustomEvent<{ readonly value: string }>).detail
        tree
          .querySelector(`ui-tree-item[value="${CSS.escape(value)}"] > ui-tree-item-label > ui-tree-item-checkbox`)
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
    } else {
      tree.mode = "single"
      tree.defaultValue = selected[0] ?? null
      onValue<string | null>(tree, "valuechange", (next) => {
        if (typeof next === "string") {
          this.setValue(field.id, next)
        }
      })
    }
    this.live.setters.set(field.id, (next) => {
      if (Array.isArray(next)) {
        tree.api?.setChecked([...next])
      } else {
        tree.api?.setValue(String(next))
      }
    })
    if (multiple) {
      return tree
    }
    const unselect = on(
      h("button", { type: "button", class: "link unselect", "aria-label": this.m.clearOf(field.label) }, this.m.clear),
      "click",
      () => {
        tree.api?.setValue(null)
        this.unset(field.id)
        this.commenting.add(field.id)
        this.refresh()
        unselect.closest(".q")?.querySelector<HTMLElement>(":scope > .q-comment textarea")?.focus()
      }
    )
    this.live.unselects.set(field.id, unselect)
    return tree
  }

  private setFolded(id: string, folded: boolean): void {
    if (folded) {
      this.folded.add(id)
    } else {
      this.folded.delete(id)
    }
    this.applyFolds()
  }

  private applyFolds(): void {
    for (const card of this.live.cards) {
      const folded = this.folded.has(card.field.id) && card.toggle !== null
      card.element.classList.toggle("folded", folded)
      card.toggle?.setAttribute("aria-expanded", String(!folded))
      describeVisible(card.element, folded)
    }
  }

  private textView(field: TextField, labelId: string, describedBy: string): HTMLElement {
    const value = String(this.values[field.id] ?? "")
    const common = { name: field.id, "aria-labelledby": labelId, "aria-describedby": describedBy, placeholder: field.placeholder }
    const input = field.multiline === true ? h("textarea", { ...common, rows: 3 }, value) : h("input", { ...common, type: "text", value })
    const typed = () => this.setValue(field.id, input.value)
    on(input, "input", typed)
    this.live.setters.set(field.id, (next) => {
      input.value = String(next)
      typed()
    })
    if (field.multiline === true) {
      return h("ui-textarea", {}, input)
    }
    return h(
      "ui-input-group",
      { class: "text-group" },
      h("ui-input", {}, input),
      h("ui-input-clear", {}, h("button", { type: "button", class: "clear", "aria-label": this.m.clearTextOf(field.label) }, "×"))
    )
  }

  private numberView(field: NumberField, labelId: string, describedBy: string): HTMLElement {
    const unset = this.values[field.id] === undefined
    const value = Number(this.values[field.id] ?? field.min)
    const text = (next: number) => `${field.prefix ?? ""}${formatNumber(next)}${field.suffix ?? ""}`
    const thumb = h("ui-slider-thumb", { "aria-labelledby": labelId, "aria-describedby": describedBy })
    const slider = h(
      "ui-slider",
      {
        min: field.min,
        max: field.max,
        step: field.step,
        "large-step": largeStep(field),
        "default-value": value,
        class: unset ? "unset" : undefined
      },
      h("ui-slider-control", {}, h("ui-slider-track", {}, h("ui-slider-indicator"), thumb))
    )
    const input = h("input", {
      class: "exact",
      inputmode: "decimal",
      role: "spinbutton",
      "aria-valuemin": field.min,
      "aria-valuemax": field.max,
      "aria-label": [field.label, field.prefix, field.suffix].filter((part) => part !== undefined).join(" "),
      "aria-describedby": describedBy
    })
    const exact = numberInput(field, field.label, input, unset ? undefined : value, this.m)
    const spoken = (next: number | null) => {
      slider.format = () => (next === null ? this.m.notAnswered : text(next))
      if (next === null) {
        input.removeAttribute("aria-valuenow")
        input.setAttribute("aria-valuetext", this.m.notAnswered)
      } else {
        input.setAttribute("aria-valuenow", String(next))
        input.setAttribute("aria-valuetext", text(next))
      }
    }
    spoken(unset ? null : value)
    const show = (next: number) => {
      slider.classList.remove("unset")
      spoken(next)
      this.setValue(field.id, next)
    }
    const update = (next: number) => {
      const clamped = Math.min(field.max, Math.max(field.min, next))
      slider.value = clamped
      exact.value = clamped
      show(clamped)
    }
    onValue<number>(slider, "valuechange", (next) => {
      exact.value = next
      show(next)
    })
    this.live.setters.set(field.id, (next) => update(Number(next)))
    onValue<number | null>(exact, "valuechange", (next) => {
      if (next !== null && Number.isFinite(next) && next >= field.min && next <= field.max) {
        slider.value = next
        show(next)
      }
    })
    onValue<number | null>(exact, "valuecommit", (next) => {
      if (next === null) {
        slider.classList.add("unset")
        spoken(null)
        this.unset(field.id)
      } else {
        update(next)
      }
    })
    return h("div", { class: "row" }, slider, exact, affix(field.suffix))
  }

  private choiceView(field: ChoiceField | SearchChoiceField, labelId: string, describedBy: string): HTMLElement {
    const multiple = field.multiple === true
    const recommended = field.default === undefined ? [] : Array.isArray(field.default) ? field.default : [field.default]
    const current = this.values[field.id]
    const rows = new Map<string, { readonly row: HTMLElement; readonly control: HTMLElement }>()
    this.live.optionRows.set(field.id, rows)
    const followUps = this.followUps.get(field.id) ?? []
    const options = field.options.map((option) => {
      const headId = uid("option")
      const textIds = [uid("summary"), uid("details"), uid("why")] as const
      const isRecommended = recommended.includes(option.value)
      const why =
        isRecommended && (field.reason !== undefined || field.reasonDetails !== undefined)
          ? recView(field, this.m.whyRecommended, undefined, null, textIds[2])
          : null
      const reveals = followUps.filter((followUp) => followUp.when?.anyOf.includes(option.value) === true).length
      const more = reveals === 0 ? null : h("span", { class: "visually-hidden", id: uid("reveals") }, this.m.revealsMore(reveals, multiple))
      const input = choiceControl(multiple, option.value, headId, [
        option.description === undefined ? undefined : textIds[0],
        option.details === undefined ? undefined : textIds[1],
        why === null ? undefined : textIds[2],
        more?.id,
        describedBy
      ])
      const row = optionRow(input, option, [headId, ...textIds], isRecommended ? this.m.recommended : undefined, why)
      if (more !== null) {
        row.querySelector(".option-text")?.append(more)
        rows.set(option.value, { row, control: input })
      }
      return row
    })
    const unselect = multiple
      ? null
      : on(
          h("button", { type: "button", class: "link unselect", "aria-label": this.m.clearOf(field.label) }, this.m.clear),
          "click",
          () => {
            group.value = null
            this.unset(field.id)
            this.commenting.add(field.id)
            this.refresh()
            group.closest(".q")?.querySelector<HTMLElement>(":scope > .q-comment textarea")?.focus()
          }
        )
    if (unselect !== null) {
      this.live.unselects.set(field.id, unselect)
    }
    const group = h(
      multiple ? "ui-checkbox-group" : "ui-radio-group",
      {
        class: "options",
        "aria-labelledby": multiple ? undefined : labelId
      },
      options
    )
    group.defaultValue = multiple ? (Array.isArray(current) ? [...current] : []) : typeof current === "string" ? current : null
    onValue<string | ReadonlyArray<string> | null>(group, "valuechange", (next) => {
      if (multiple) {
        this.setValue(field.id, Array.isArray(next) ? [...next] : [])
      } else if (typeof next === "string") {
        this.setValue(field.id, next)
      }
    })
    this.live.setters.set(field.id, (next) => {
      group.value = Array.isArray(next) ? [...next] : (next as string)
    })
    return group
  }

  private searchChoiceView(field: SearchChoiceField, labelId: string, describedBy: string): HTMLElement {
    const group = this.choiceView(field, labelId, describedBy)
    group.classList.add("search")
    const filter = h("input", { type: "search", "aria-label": this.m.filterOf(field.label), placeholder: this.m.searchOptions })
    const count = h("span", { class: "filter-count", "aria-live": "polite" })
    const empty = h("p", { class: "no-match", hidden: true }, this.m.noMatches)
    const picked = h("p", { class: "picked" })
    const rows = [...group.querySelectorAll<HTMLElement>(":scope > label.option")]
    const total = rows.length
    const apply = () => {
      const query = filter.value.trim().toLowerCase()
      let shown = 0
      for (const row of rows) {
        const text =
          (row.querySelector(".option-head")?.textContent ?? "") + " " + (row.querySelector(".option-summary")?.textContent ?? "")
        const hit = query === "" || text.toLowerCase().includes(query)
        row.hidden = !hit
        row.querySelector<HTMLElement>("ui-radio, ui-checkbox")?.toggleAttribute("disabled", !hit)
        shown += hit ? 1 : 0
      }
      count.textContent = `${shown} / ${total}`
      empty.hidden = shown > 0
    }
    on(filter, "input", () => {
      apply()
      this.drawBranches()
    })
    on(group, "scroll", () => this.drawBranches())
    on(filter, "keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        rows
          .find((row) => !row.hidden)
          ?.querySelector<HTMLElement>("ui-radio, ui-checkbox")
          ?.focus()
      }
    })
    this.live.pickedLists.set(field.id, { element: picked, field })
    apply()
    return h("div", { class: "search-choice" }, h("div", { class: "filter-row" }, h("ui-input", {}, filter), count), group, empty, picked)
  }

  private noteView(): HTMLElement {
    const hintId = uid("note")
    const input = h("textarea", { rows: 3, maxlength: maxNoteLength, "aria-label": this.m.note, "aria-describedby": hintId }, this.note)
    on(input, "input", () => {
      if (input.value.length > maxNoteLength) {
        input.value = input.value.slice(0, maxNoteLength).replace(/[\uD800-\uDBFF]$/, "")
      }
      this.note = input.value
    })
    const element = collapsible("note", this.noteOpen, this.m.note, h("p", { class: "q-desc", id: hintId }, this.m.noteHint), input)
    element.addEventListener("openchange", (event) => {
      this.noteOpen = (event as CustomEvent<{ readonly value: boolean }>).detail.value
    })
    return element
  }

  private computedView(): HTMLElement {
    const element = h("section", { class: "computed", "aria-live": "polite", "aria-label": this.m.results })
    this.live.computed = element
    return element
  }

  private footer(label: string, onPrimary: () => void, before: ReadonlyArray<HTMLElement>, after: ReadonlyArray<HTMLElement>): HTMLElement {
    const primary = h("button", { type: "button", class: "primary" }, label)
    this.live.primary = primary
    const status = h("span", { class: "status", role: "status" })
    this.live.status = status
    return h("footer", { class: "actions" }, ...before, status, ...after, h("ui-button", {}, on(primary, "click", onPrimary)))
  }

  private ghost(label: string, onClick: () => void): HTMLElement {
    return h("ui-button", {}, on(h("button", { type: "button", class: "ghost" }, label), "click", onClick))
  }

  private answerFooter(): HTMLElement {
    return this.footer(
      this.m.submit,
      () => void this.answer("submit"),
      [this.ghost(this.m.dismiss, () => void this.answer("chat"))],
      [
        this.remainingView(),
        h("kbd", { class: "shortcut", "aria-hidden": "true" }, /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘⏎" : "Ctrl+⏎")
      ]
    )
  }

  private remainingView(): HTMLElement {
    const element = on(h("button", { type: "button", class: "remaining", hidden: true }), "click", () => this.focusNextUnanswered())
    this.live.remaining = element
    return h("ui-button", {}, element)
  }

  private focusNextUnanswered(): void {
    const form = this.form
    if (form === undefined) {
      return
    }
    const missing = new Set(unansweredFields(form.spec, this.current(), this.commented()).map((field) => field.id))
    const cards = this.live.cards.filter((card) => missing.has(card.field.id))
    const from = this.live.cards.findIndex((card) => card.field.id === this.jumped)
    const next = cards.find((card) => this.live.cards.indexOf(card) > from) ?? cards[0]
    this.jumped = next?.field.id
    focusControl(next?.element)
  }

  private refreshShown(form: CompiledForm): void {
    const shown = new Set(activeFields(form.spec, this.current()).map((field) => field.id))
    const focused = this.live.cards.find((card) => card.element.contains(document.activeElement))
    for (const card of this.live.cards) {
      card.element.hidden = !shown.has(card.field.id)
    }
    if (focused?.element.hidden !== true) {
      return
    }
    const owner = (field: Field): Field | undefined => {
      const source = form.spec.fields.find((item) => item.id === field.when?.field)
      return source === undefined || shown.has(source.id) ? source : owner(source)
    }
    const target = owner(focused.field)
    focusControl(this.live.cards.find((card) => card.field.id === target?.id)?.element)
  }

  private refreshReveals(form: CompiledForm): void {
    const current = this.current()
    for (const card of this.live.cards) {
      const reveal = this.live.reveals.get(card.field.id)
      const source = this.sourceOf(card.field)
      if (reveal === undefined || source === undefined || card.element.hidden) {
        continue
      }
      const value = current[source.id]
      const answers = source.options
        .filter((option) => card.field.when?.anyOf.includes(option.value) === true)
        .filter((option) => (Array.isArray(value) ? value.includes(option.value) : value === option.value))
        .map((option) => option.label)
      const checkbox = isMultiple(source)
      reveal.chip.replaceChildren(
        h("span", { class: checkbox ? "reveal-mark check" : "reveal-mark" }),
        h("span", { class: "reveal-text" }, answers.join(this.m.revealSeparator))
      )
      reveal.reason.textContent = this.m.revealedBy(source.label, answers, checkbox)
    }
    if (this.hot !== undefined && !new Set(activeFields(form.spec, current).map((field) => field.id)).has(this.hot)) {
      this.hot = undefined
    }
    this.drawBranches()
  }

  private drawBranches(): void {
    const form = this.form
    const container = this.live.fields
    const canvas = this.live.canvas
    if (form === undefined || container === undefined || canvas === undefined || !container.isConnected) {
      return
    }
    const current = this.current()
    const cards = new Map(this.live.cards.map((card) => [card.field.id, card.element]))
    const visible = (id: string) => cards.get(id)?.hidden === false
    const labelOf = (id: string) => cards.get(id)?.querySelector<HTMLElement>(".q-label") ?? undefined
    const lanes = [...this.followUps].flatMap(([id, followUps]): ReadonlyArray<BranchLane> => {
      const anchor = labelOf(id)
      const rows = this.live.optionRows.get(id)
      if (!visible(id) || anchor === undefined || rows === undefined) {
        return []
      }
      const value = current[id]
      return [
        {
          depth: this.depthOf(id),
          anchor,
          options: [...rows].map(([option, { row, control }]) => ({
            value: option,
            row,
            control,
            selected: Array.isArray(value) ? value.includes(option) : value === option
          })),
          followUps: followUps.flatMap((followUp) => {
            const card = cards.get(followUp.id)
            const label = labelOf(followUp.id)
            return card === undefined || label === undefined || !visible(followUp.id)
              ? []
              : [{ id: followUp.id, card, label, anyOf: followUp.when?.anyOf ?? [] }]
          })
        }
      ]
    })
    drawBranches(container, canvas, lanes, this.hot)
  }

  private refreshRemaining(count: number): void {
    const button = this.live.remaining
    if (button === undefined) {
      return
    }
    button.hidden = count === 0
    button.textContent = this.m.remaining(count)
    button.title = this.m.nextUnanswered
    button.classList.toggle("alert", this.showMissing)
  }

  private answerTag(state: "unanswered" | "unset" | "recommended" | "answered"): HTMLElement | string {
    switch (state) {
      case "unanswered":
        return this.missingTag()
      case "unset":
        return h("span", { class: "muted" }, this.m.held)
      case "recommended":
        return h("span", { class: "badge" }, this.m.recommended)
      case "answered":
        return ""
    }
  }

  private refreshRecommended(card: (typeof this.live.cards)[number], unset: boolean, changed: boolean): boolean {
    const asRecommended = !picks(card.field) && card.field.default !== undefined && !changed && !unset
    const hide = asRecommended && !reasoned(card.field)
    if (card.rec !== null && card.rec.hidden !== hide) {
      card.rec.hidden = hide
      describeVisible(card.element, card.element.classList.contains("folded"))
    }
    if (card.back !== null) {
      card.back.hidden = !changed
    }
    return asRecommended
  }

  private refreshCards(): void {
    if (this.form === undefined) {
      return
    }
    const current = this.current()
    const sinceRecommended = changedFields(this.form.spec, this.initial, current)
    const missing = new Set(unansweredFields(this.form.spec, current, this.commented()).map((field) => field.id))
    this.refreshRemaining(missing.size)
    for (const card of this.live.cards) {
      const unanswered = missing.has(card.field.id)
      const unset = current[card.field.id] === undefined
      markInvalid(card.element, unanswered && this.showMissing)
      const asRecommended = this.refreshRecommended(card, unset, sinceRecommended.includes(card.field.id))
      card.answer.replaceChildren(this.answerTag(unanswered ? "unanswered" : unset ? "unset" : asRecommended ? "recommended" : "answered"))
      this.refreshComment(card.field, card.comment, card.open, unset)
    }
  }

  private refreshComment(field: Field, element: HTMLElement, button: HTMLElement, unset: boolean): void {
    const open = this.commenting.has(field.id)
    const input = element.querySelector("textarea")
    if (input === null) {
      return
    }
    button.setAttribute("aria-expanded", String(open))
    button.classList.toggle("has-comment", (this.comments[field.id] ?? "").trim() !== "")
    element.hidden = !open
    input.placeholder = unset ? this.m.unsetHint : this.m.commentHint
  }

  private missingTag(): HTMLElement {
    return h("span", { class: this.showMissing ? "missing-tag error" : "missing-tag" }, this.m.notAnswered)
  }

  private initialText(field: Field): string | undefined {
    return field.default === undefined ? undefined : describeValue(field, this.initial[field.id], this.m)
  }

  private refreshComputed(form: CompiledForm): void {
    const values = computeValues(form, this.current())
    const container = this.live.computed
    if (container === undefined) {
      return
    }
    for (const item of form.spec.computed ?? []) {
      const text = describeComputed(item, values[item.id], this.m)
      let value = container.querySelector<HTMLElement>(`[data-metric="${item.id}"]`)
      if (value === null) {
        value = h("span", { class: "metric-value", "data-metric": item.id })
        container.append(
          h("div", { class: item.primary === true ? "metric primary" : "metric" }, h("span", { class: "metric-label" }, item.label), value)
        )
      }
      if (value.textContent !== text) {
        value.textContent = text
      }
    }
  }

  private statusText(): string {
    if (this.error !== undefined) {
      return this.error
    }
    return this.busy ? this.m.sending : ""
  }

  private refresh(): void {
    const form = this.form
    if (form === undefined) {
      return
    }
    for (const [id, unselect] of this.live.unselects) {
      unselect.hidden = this.values[id] === undefined
    }
    for (const [id, picked] of this.live.pickedLists) {
      const value = this.values[id]
      const chosen = picked.field.options.filter((option) => (Array.isArray(value) ? value.includes(option.value) : value === option.value))
      picked.element.textContent =
        this.m.picked + (chosen.length === 0 ? this.m.none : chosen.map((option) => option.label).join(this.m.listSeparator))
    }
    for (const reset of this.live.resets.values()) {
      reset.element.hidden = !reset.changed()
    }
    this.refreshShown(form)
    this.refreshCards()
    this.refreshReveals(form)
    this.refreshComputed(form)
    if (this.live.status !== undefined) {
      this.live.status.textContent = this.statusText()
      this.live.status.classList.toggle("error", this.error !== undefined)
    }
    if (this.live.form !== undefined) {
      this.live.form.inert = this.busy
    }
    if (this.live.primary !== undefined) {
      this.live.primary.disabled = this.busy
    }
  }
}
