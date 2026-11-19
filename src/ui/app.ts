import {
  activeFields,
  answerValues,
  changedFields,
  computeValues,
  describeComputed,
  describeValue,
  formatNumber,
  heldFields,
  initialValues,
  maxNoteLength,
  prepare,
  unansweredFields,
  withoutHeld,
  type CompiledForm,
  type FieldValue,
  type Values
} from "../core/form.ts"
import { languageOf, messages, type Messages } from "../core/messages.ts"
import type { ChoiceField, Field, FormSpec, NumberField, TextField } from "../core/spec.ts"
import type { Bridge, HostContext, ToolResult } from "./bridge.ts"
import { h, on, uid } from "./dom.ts"
import { watchStatus } from "./status.ts"

type Status = "submitted" | "answer_in_chat" | "unavailable"

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "answering" }
  | { readonly kind: "summary"; readonly status: Status }
  | { readonly kind: "closed"; readonly reason: "cancelled" | "expired" }

type Action = "submit" | "chat"

const statusOf: Readonly<Record<Action, Status>> = { submit: "submitted", chat: "answer_in_chat" }

const isStatus = (value: unknown): value is Status => value === "submitted" || value === "answer_in_chat" || value === "unavailable"

const resultText = (result: ToolResult): string => (result.content ?? []).map((item) => item.text ?? "").join("\n")

const isExpired = (result: ToolResult): boolean => result.isError === true && /expired/.test(resultText(result))

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

const hasDetails = (field: Field): boolean =>
  (field.default !== undefined && (field.reason !== undefined || field.reasonDetails !== undefined || field.type !== "choice")) ||
  (field.type === "choice" && field.options.some((option) => option.details !== undefined))

const markInvalid = (card: HTMLElement, invalid: boolean): void => {
  card.classList.toggle("missing", invalid)
  for (const input of card.querySelectorAll(":scope > .q-group input, :scope > .q-group textarea")) {
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
      return target !== null && !(folded && target.matches(".option-details, .rec"))
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

export class FormApp {
  private phase: Phase = { kind: "loading" }
  private m: Messages = messages("en")
  private form: CompiledForm | undefined
  private values: Record<string, FieldValue> = {}
  private readonly held = new Set<string>()
  private initial: Values = {}
  private summaryValues: Values = {}
  private note = ""
  private noteOpen = false
  private busy = false
  private error: string | undefined
  private bridge: Bridge | undefined
  private stopStatus: (() => void) | undefined
  private readonly live = {
    cards: [] as Array<{
      readonly field: Field
      readonly element: HTMLElement
      readonly toggle: HTMLElement | null
      readonly answer: HTMLElement
      readonly back: HTMLElement | null
    }>,
    branches: [] as Array<{ readonly id: string; readonly value: string; readonly element: HTMLElement }>,
    computed: undefined as HTMLElement | undefined,
    status: undefined as HTMLElement | undefined,
    primary: undefined as HTMLButtonElement | undefined,
    form: undefined as HTMLElement | undefined,
    setters: new Map<string, (value: FieldValue) => void>()
  }
  private readonly folded = new Set<string>()
  private showMissing = false
  private keepFocus = false

  private readonly root: HTMLElement

  constructor(root: HTMLElement) {
    this.root = root
    this.render()
  }

  attach(bridge: Bridge): void {
    this.bridge = bridge
    this.syncStatus()
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
    this.summaryValues = this.initial
    this.note = ""
    this.noteOpen = false
    this.held.clear()
    this.folded.clear()
    this.showMissing = false
    if (this.phase.kind === "loading") {
      this.phase = { kind: "answering" }
    }
    this.render()
  }

  setResult(result: ToolResult): void {
    if (this.phase.kind === "closed" && result.structuredContent?.["status"] !== "unavailable") {
      return
    }
    if (result.isError === true) {
      if (this.phase.kind === "loading" || this.phase.kind === "answering") {
        this.phase = { kind: "invalid", message: resultText(result) }
        this.render()
      }
      return
    }
    const content = result.structuredContent ?? {}
    const status = content["status"]
    if (!isStatus(status)) {
      return
    }
    const values = content["values"]
    if (values !== undefined && typeof values === "object" && values !== null && this.form !== undefined) {
      this.summaryValues = values as Values
      this.note = typeof content["note"] === "string" ? content["note"] : ""
    }
    this.phase = { kind: "summary", status }
    this.render()
  }

  setCancelled(): void {
    if (this.phase.kind === "loading" || this.phase.kind === "answering") {
      this.phase = { kind: "closed", reason: "cancelled" }
      this.render()
    }
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

  private applyAnswer(action: Action, result: ToolResult, values: Values): void {
    if (this.phase.kind !== "answering") {
      return
    }
    if (isExpired(result)) {
      this.phase = { kind: "closed", reason: "expired" }
      return
    }
    if (result.isError === true) {
      this.error = resultText(result)
      return
    }
    this.summaryValues = values
    this.note = this.note.trim()
    this.phase = { kind: "summary", status: statusOf[action] }
  }

  private blockUnanswered(form: CompiledForm): boolean {
    const unanswered = unansweredFields(form.spec, this.current(), this.held)
    if (unanswered.length === 0) {
      return false
    }
    this.error = this.m.unanswered(unanswered.map((field) => field.label))
    this.showMissing = true
    this.refresh()
    const first = this.live.cards.find((card) => card.field.id === unanswered[0]?.id)
    const details = first?.element.closest("details")
    if (details !== null && details !== undefined) {
      details.open = true
    }
    first?.element.querySelector<HTMLElement>(":scope > .q-group input, :scope > .q-group textarea")?.focus()
    return true
  }

  private answer(action: Action): Promise<void> {
    const form = this.form
    if (form === undefined) {
      return Promise.resolve()
    }
    const values = this.answered(this.current())
    if (action === "submit" && this.blockUnanswered(form)) {
      return Promise.resolve()
    }
    return this.whileBusy(async (bridge) => {
      const result = await bridge.callTool("form_answer", {
        formKey: form.key,
        action,
        ...(action === "submit" ? { values, held: heldFields(form.spec, values), note: this.note } : {})
      })
      this.applyAnswer(action, result, values)
    })
  }

  private answered(values: Values): Values {
    return this.form === undefined ? values : answerValues(this.form.spec, values)
  }

  private current(): Values {
    return this.form === undefined ? this.values : withoutHeld(this.form.spec, this.values, this.held)
  }

  private setValue(id: string, value: FieldValue): void {
    this.values[id] = value
    this.held.delete(id)
    this.error = undefined
    this.refresh()
  }

  private setHeld(id: string, held: boolean): void {
    if (held) {
      this.held.add(id)
    } else {
      this.held.delete(id)
    }
    this.error = undefined
    this.refresh()
  }

  private holdInput(field: Field): HTMLInputElement | null {
    return field.type === "text" ? null : h("input", { type: "checkbox", checked: this.held.has(field.id), title: this.m.holdHint })
  }

  private syncStatus(): void {
    if (this.phase.kind === "answering" && this.form !== undefined && this.bridge !== undefined) {
      this.stopStatus ??= watchStatus(this.bridge, this.form.key, () => this.setCancelled())
    } else {
      this.stopStatus?.()
      this.stopStatus = undefined
    }
  }

  private render(): void {
    this.syncStatus()
    this.live.cards.length = 0
    this.live.branches.length = 0
    this.live.setters.clear()
    this.live.computed = undefined
    this.live.status = undefined
    this.live.primary = undefined
    this.live.form = undefined
    const hadFocus = this.keepFocus || this.root.contains(document.activeElement)
    this.keepFocus = false
    this.root.classList.remove("motion")
    this.root.replaceChildren(this.view())
    if (hadFocus) {
      this.root.querySelector<HTMLElement>("[data-focus]")?.focus()
    }
    requestAnimationFrame(() => this.root.classList.add("motion"))
    this.applyFolds()
    this.refresh()
  }

  private view(): HTMLElement {
    const phase = this.phase
    switch (phase.kind) {
      case "loading":
        return h("p", { class: "notice", role: "status" }, this.m.waiting)
      case "invalid":
        return h("div", { class: "card", role: "alert" }, h("pre", { class: "error" }, phase.message))
      case "closed":
        return h("div", { class: "card closed", role: "status" }, phase.reason === "cancelled" ? this.m.cancelled : this.m.expired)
      case "summary":
        return this.summary(phase.status)
      case "answering":
        return this.formView()
    }
  }

  private formView(): HTMLElement {
    const form = this.form
    if (form === undefined) {
      return h("p", { class: "notice" }, this.m.waiting)
    }
    const spec = form.spec
    const basic = spec.fields.filter((field) => field.advanced !== true)
    const advanced = spec.fields.filter((field) => field.advanced === true)
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
      h(
        "div",
        { class: "fields" },
        basic.map((field) => this.card(field))
      ),
      advanced.length === 0
        ? null
        : h(
            "details",
            { class: "advanced" },
            h("summary", {}, this.m.details),
            h(
              "div",
              { class: "fields" },
              advanced.map((field) => this.card(field))
            )
          ),
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

  private reveal(field: ChoiceField, option: ChoiceField["options"][number]): HTMLElement | null {
    if (!("fields" in option) || option.fields === undefined) {
      return null
    }
    const element = h(
      "div",
      { class: "reveal" },
      option.fields.map((nested) => this.card(nested))
    )
    this.live.branches.push({ id: field.id, value: option.value, element })
    return element
  }

  private card(field: Field): HTMLElement {
    const labelId = uid("label")
    const descId = field.description === undefined ? undefined : uid("desc")
    const groupId = uid("group")
    const answer = h("span", { class: "q-answer", id: uid("answer") })
    const hold = this.holdInput(field)
    const toggle = hasDetails(field)
      ? h("button", {
          type: "button",
          class: "fold",
          "aria-label": this.m.detailsOf(field.label),
          title: this.m.detailsOf(field.label),
          "aria-controls": groupId
        })
      : null
    const back = field.type === "choice" ? null : h("button", { type: "button", class: "link", hidden: true }, this.m.backToRecommended)
    const recommended = this.initialText(field)
    const rec =
      field.type === "choice" || recommended === undefined ? null : recView(field, this.m.recommended, recommended, back, uid("rec"))
    const element = h(
      "div",
      { class: "q", role: "group", "aria-labelledby": labelId, "aria-describedby": descId },
      h(
        "div",
        { class: "q-head" },
        toggle ?? h("span", { class: "fold-space" }),
        h("span", { class: "q-label", id: labelId }, field.label),
        answer,
        hold === null ? null : h("label", { class: "hold", title: this.m.holdHint }, hold, this.m.hold)
      ),
      field.description === undefined ? null : h("p", { class: "q-desc", id: descId }, field.description),
      h(
        "div",
        { class: field.type === "choice" ? "q-group choices" : "q-group", id: groupId },
        this.control(field, labelId, [answer.id, rec?.id].filter((id) => id !== undefined && id !== "").join(" "), hold),
        rec
      )
    )
    this.live.cards.push({ field, element, toggle, answer, back })
    if (back !== null) {
      on(back, "click", () => {
        this.live.setters.get(field.id)?.(this.initial[field.id] as FieldValue)
        element.querySelector<HTMLElement>(":scope > .q-group input, :scope > .q-group textarea")?.focus()
      })
    }
    if (toggle !== null) {
      on(toggle, "click", () => this.setFolded(field.id, !this.folded.has(field.id)))
      const head = element.querySelector<HTMLElement>(".q-head")
      if (head !== null) {
        on(head, "click", (event) => {
          if (event.target !== toggle && (event.target as HTMLElement).closest(".hold") === null) {
            this.setFolded(field.id, !this.folded.has(field.id))
          }
        })
      }
      const unfold = (event: Event) => {
        const target = event.target as HTMLElement
        const choosing = target.closest(".option") !== null && !(event.type === "focusin" && target.matches(":focus-visible"))
        if (target.closest(".q-head") === null && !choosing && target.closest(".q") === element) {
          this.setFolded(field.id, false)
        }
      }
      on(element, "pointerdown", unfold)
      on(element, "focusin", unfold)
    }
    return element
  }

  private control(field: Field, labelId: string, describedBy: string, hold: HTMLInputElement | null): HTMLElement {
    switch (field.type) {
      case "text":
        return this.textView(field, labelId, describedBy)
      case "number":
        return this.numberView(field, labelId, describedBy, hold ?? h("input"))
      case "choice":
        return this.choiceView(field, describedBy, hold ?? h("input"))
    }
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
    on(input, "input", () => this.setValue(field.id, input.value))
    this.live.setters.set(field.id, (next) => {
      input.value = String(next)
      this.setValue(field.id, input.value)
    })
    return input
  }

  private numberView(field: NumberField, labelId: string, describedBy: string, hold: HTMLInputElement): HTMLElement {
    const unset = this.values[field.id] === undefined || this.held.has(field.id)
    const value = Number(this.values[field.id] ?? field.min)
    const step = field.step ?? "any"
    const text = (next: number) => `${field.prefix ?? ""}${formatNumber(next)}${field.suffix ?? ""}`
    const slider = h("input", {
      type: "range",
      min: field.min,
      max: field.max,
      step,
      value,
      class: unset ? "unset" : undefined,
      "aria-labelledby": labelId,
      "aria-describedby": describedBy,
      "aria-valuetext": unset ? this.m.notAnswered : text(value)
    })
    const exact = h("input", {
      type: "number",
      min: field.min,
      max: field.max,
      step,
      value: unset ? "" : value,
      class: "exact",
      "aria-label": [field.label, field.prefix, field.suffix].filter((part) => part !== undefined).join(" "),
      "aria-describedby": describedBy
    })
    const show = (next: number) => {
      slider.classList.remove("unset")
      hold.checked = false
      slider.value = String(next)
      slider.setAttribute("aria-valuetext", text(next))
      this.setValue(field.id, next)
    }
    const update = (next: number) => {
      const clamped = Math.min(field.max, Math.max(field.min, next))
      exact.value = String(clamped)
      show(clamped)
    }
    on(slider, "input", () => update(Number(slider.value)))
    this.live.setters.set(field.id, (next) => update(Number(next)))
    on(exact, "input", () => {
      const next = Number(exact.value)
      if (exact.value !== "" && Number.isFinite(next) && next >= field.min && next <= field.max) {
        show(next)
      }
    })
    on(exact, "change", () => {
      if (exact.value !== "" && Number.isFinite(Number(exact.value))) {
        update(Number(exact.value))
      } else {
        exact.value = typeof this.values[field.id] === "number" && !this.held.has(field.id) ? slider.value : ""
      }
    })
    on(hold, "change", () => {
      const stored = this.values[field.id]
      if (hold.checked || typeof stored !== "number") {
        slider.classList.add("unset")
        slider.setAttribute("aria-valuetext", hold.checked ? this.m.held : this.m.notAnswered)
        exact.value = ""
        this.setHeld(field.id, hold.checked)
      } else {
        update(stored)
      }
    })
    return h("div", { class: "row" }, slider, affix(field.prefix), exact, affix(field.suffix))
  }

  private choiceView(field: ChoiceField, describedBy: string, hold: HTMLInputElement): HTMLElement {
    const multiple = field.multiple === true
    const recommended = field.default === undefined ? [] : Array.isArray(field.default) ? field.default : [field.default]
    const name = uid(field.id)
    const current = this.held.has(field.id) ? undefined : this.values[field.id]
    let pointing = false
    const options = field.options.flatMap((option) => {
      const checked = multiple ? Array.isArray(current) && current.includes(option.value) : current === option.value
      const headId = uid("option")
      const textIds = [uid("summary"), uid("details"), uid("why")] as const
      const isRecommended = recommended.includes(option.value)
      const why =
        isRecommended && (field.reason !== undefined || field.reasonDetails !== undefined)
          ? recView(field, this.m.whyRecommended, undefined, null, textIds[2])
          : null
      const input = h("input", {
        type: multiple ? "checkbox" : "radio",
        name,
        value: option.value,
        checked,
        "aria-labelledby": headId,
        "aria-describedby": [
          option.description === undefined ? undefined : textIds[0],
          option.details === undefined ? undefined : textIds[1],
          why === null ? undefined : textIds[2],
          describedBy
        ]
          .filter((id) => id !== undefined && id !== "")
          .join(" ")
      })
      on(input, "change", () => {
        hold.checked = false
        if (multiple) {
          const selected = Array.isArray(this.values[field.id]) ? [...(this.values[field.id] as ReadonlyArray<string>)] : []
          this.setValue(field.id, input.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))
        } else if (input.checked) {
          this.setValue(field.id, option.value)
          if (pointing) {
            this.setFolded(field.id, true)
          }
        }
        pointing = false
      })
      const row = optionRow(input, option, [headId, ...textIds], isRecommended ? this.m.recommended : undefined, why)
      const revealed = this.reveal(field, option)
      return revealed === null ? [row] : [row, revealed]
    })
    on(hold, "change", () => {
      if (hold.checked) {
        if (multiple) {
          this.values[field.id] = []
        }
        for (const input of group.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
          input.checked = false
        }
      } else if (!multiple && typeof this.values[field.id] === "string") {
        const previous = group.querySelector<HTMLInputElement>(
          `input[name="${name}"][value="${CSS.escape(String(this.values[field.id]))}"]`
        )
        if (previous !== null) {
          previous.checked = true
        }
      }
      this.setHeld(field.id, hold.checked)
    })
    const group = h("div", { class: "options" }, options)
    on(group, "pointerdown", (event) => {
      pointing = (event.target as HTMLElement).closest(".reveal") === null
    })
    on(group, "keydown", () => {
      pointing = false
    })
    return group
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
    const element = h(
      "details",
      { class: "note", open: this.noteOpen },
      h("summary", {}, this.m.note),
      h("p", { class: "q-desc", id: hintId }, this.m.noteHint),
      input
    )
    on(element, "toggle", () => {
      this.noteOpen = element.open
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
    return h("footer", { class: "actions" }, ...before, status, ...after, on(primary, "click", onPrimary))
  }

  private ghost(label: string, onClick: () => void): HTMLElement {
    return on(h("button", { type: "button", class: "ghost" }, label), "click", onClick)
  }

  private answerFooter(): HTMLElement {
    return this.footer(
      this.m.submit,
      () => void this.answer("submit"),
      [this.ghost(this.m.dismiss, () => void this.answer("chat"))],
      [h("kbd", { class: "shortcut", "aria-hidden": "true" }, /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘⏎" : "Ctrl+⏎")]
    )
  }

  private summary(status: Status): HTMLElement {
    const form = this.form
    const title = { submitted: this.m.answered, answer_in_chat: this.m.answeredInChat, unavailable: this.m.unavailable }[status]
    const head = h(
      "div",
      { class: "summary-head" },
      h("span", { class: "check", "aria-hidden": "true" }, "✓"),
      h("span", { tabindex: -1, "data-focus": true }, title)
    )
    if (form === undefined || status !== "submitted") {
      return h("section", { class: "card summary", role: "status" }, head)
    }
    const changedByUser = changedFields(form.spec, this.initial, this.summaryValues)
    const rows = activeFields(form.spec, this.summaryValues).map((field) =>
      h(
        "div",
        { class: "summary-row" },
        h("dt", {}, field.label),
        h(
          "dd",
          {},
          describeValue(field, this.summaryValues[field.id], this.m),
          changedByUser.includes(field.id) && field.default !== undefined
            ? h("span", { class: "mark" }, this.m.recommendedWas(describeValue(field, this.initial[field.id], this.m)))
            : null
        )
      )
    )
    const noted =
      this.note === "" ? null : h("div", { class: "summary-row" }, h("dt", {}, this.m.noted), h("dd", { class: "noted" }, this.note))
    return h("section", { class: "card summary" }, head, h("dl", {}, rows, noted))
  }

  private refreshCards(): void {
    if (this.form === undefined) {
      return
    }
    const current = this.current()
    const sinceRecommended = changedFields(this.form.spec, this.initial, current)
    const missing = new Set(unansweredFields(this.form.spec, current, this.held).map((field) => field.id))
    const held = heldFields(this.form.spec, current)
    for (const card of this.live.cards) {
      const unanswered = missing.has(card.field.id)
      markInvalid(card.element, unanswered && this.showMissing)
      card.answer.replaceChildren(
        unanswered
          ? this.missingTag()
          : held.includes(card.field.id) && card.field.type === "text"
            ? h("span", { class: "held-tag" }, this.m.held)
            : ""
      )
      if (card.back !== null) {
        card.back.hidden = !sinceRecommended.includes(card.field.id)
      }
    }
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
    for (const branch of this.live.branches) {
      branch.element.hidden = this.held.has(branch.id) || this.values[branch.id] !== branch.value
    }
    this.refreshCards()
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
