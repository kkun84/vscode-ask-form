import {
  activeFields,
  allFields,
  answerValues,
  changedFields,
  computeValues,
  describeComputed,
  describeValue,
  formatNumber,
  initialValues,
  prepare,
  type CompiledForm,
  type FieldValue,
  type Values
} from "../core/form.ts"
import { languageOf, messages, type Messages } from "../core/messages.ts"
import type { ChoiceField, Field, FormSpec, NumberField, TextField, ToggleField } from "../core/spec.ts"
import type { Bridge, HostContext, ToolResult } from "./bridge.ts"
import { h, on, uid } from "./dom.ts"
import { watchStatus } from "./status.ts"

type Status = "submitted" | "delegated" | "answer_in_chat"

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "answering" }
  | { readonly kind: "summary"; readonly status: Status }
  | { readonly kind: "resending" }
  | { readonly kind: "closed"; readonly reason: "cancelled" | "expired" }

type Action = "submit" | "delegate" | "chat"

const statusOf: Readonly<Record<Action, Status>> = { submit: "submitted", delegate: "delegated", chat: "answer_in_chat" }

const isStatus = (value: unknown): value is Status => value === "submitted" || value === "delegated" || value === "answer_in_chat"

const resultText = (result: ToolResult): string => (result.content ?? []).map((item) => item.text ?? "").join("\n")

const isExpired = (result: ToolResult): boolean => result.isError === true && /expired/.test(resultText(result))

const whyView = (field: Field, prefix: string): HTMLElement | null =>
  field.reason === undefined
    ? null
    : h(
        "span",
        { class: "why" },
        h("span", {}, `${prefix}: ${field.reason}`),
        field.reasonDetails === undefined ? null : h("span", { class: "why-details" }, field.reasonDetails)
      )

const optionWhyView = (field: Field, m: Messages): HTMLElement | null =>
  field.reason === undefined
    ? null
    : h(
        "span",
        { class: "option-why" },
        h("span", { class: "option-why-label" }, m.whyRecommended),
        h("span", {}, field.reason),
        field.reasonDetails === undefined ? null : h("span", { class: "why-details" }, field.reasonDetails)
      )

const hasDetails = (field: Field): boolean =>
  field.reasonDetails !== undefined || (field.type === "choice" && field.options.some((option) => option.details !== undefined))

const affix = (content: string | undefined): HTMLElement | null => (content === undefined ? null : h("span", { class: "muted" }, content))

export class FormApp {
  private phase: Phase = { kind: "loading" }
  private m: Messages = messages("en")
  private locale: string | undefined
  private form: CompiledForm | undefined
  private rawSpec: Readonly<Record<string, unknown>> = {}
  private values: Record<string, FieldValue> = {}
  private guesses: Values = {}
  private remembered: Values = {}
  private baseline: Values = {}
  private summaryValues: Values = {}
  private placed = false
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
      readonly note: HTMLElement
    }>,
    branches: [] as Array<{ readonly id: string; readonly value: string; readonly element: HTMLElement }>,
    computed: undefined as HTMLElement | undefined,
    status: undefined as HTMLElement | undefined,
    primary: undefined as HTMLButtonElement | undefined,
    form: undefined as HTMLElement | undefined
  }
  private readonly folded = new Set<string>()

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
      this.locale = context.locale
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
    this.rawSpec = args
    this.guesses = initialValues(form.spec)
    this.remembered = this.guesses
    this.values = { ...this.guesses }
    this.baseline = this.guesses
    this.summaryValues = this.guesses
    this.placed = false
    this.folded.clear()
    if (this.phase.kind === "loading") {
      this.phase = { kind: "answering" }
    }
    this.render()
  }

  setResult(result: ToolResult): void {
    if (this.phase.kind === "closed") {
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
    if (!isStatus(status) || this.phase.kind === "resending") {
      return
    }
    const values = content["values"]
    if (values !== undefined && typeof values === "object" && values !== null && this.form !== undefined) {
      this.remembered = { ...this.values }
      this.baseline = values as Values
      this.summaryValues = this.baseline
      this.placed = false
      this.values = this.editable(this.baseline)
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

  private async whileBusy(task: (bridge: Bridge) => Promise<void>, failurePrefix = ""): Promise<void> {
    if (this.bridge === undefined || this.busy) {
      return
    }
    this.busy = true
    this.error = undefined
    this.refresh()
    try {
      await task(this.bridge)
    } catch (error) {
      this.error = `${failurePrefix}${error instanceof Error ? error.message : String(error)}`
    } finally {
      this.busy = false
      this.render()
    }
  }

  private applyAnswer(action: Action, result: ToolResult, values: Values): void {
    if (this.phase.kind === "closed") {
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
    this.remembered = { ...this.values }
    this.baseline = action === "delegate" ? this.answered(this.guesses) : values
    this.summaryValues = this.baseline
    this.values = this.editable(this.baseline)
    this.phase = { kind: "summary", status: statusOf[action] }
  }

  private answer(action: Action): Promise<void> {
    const form = this.form
    if (form === undefined) {
      return Promise.resolve()
    }
    const values = this.answered(this.values)
    return this.whileBusy(async (bridge) => {
      const result = await bridge.callTool("form_answer", {
        formKey: form.key,
        action,
        ...(action === "submit" ? { values } : {})
      })
      this.applyAnswer(action, result, values)
    })
  }

  private resend(): Promise<void> {
    if (this.changedSinceAnswer().length === 0) {
      return Promise.resolve()
    }
    const after = this.answered(this.values)
    return this.whileBusy(async (bridge) => {
      const result = await bridge.callTool("form_resend", {
        spec: this.rawSpec,
        before: this.baseline,
        after,
        ...(this.locale === undefined ? {} : { locale: this.locale })
      })
      if (result.isError === true) {
        this.error = `${this.m.sendFailed}: ${resultText(result)}`
        return
      }
      const failure = await this.deliver(bridge, result)
      if (failure === undefined) {
        this.remembered = { ...this.values }
        this.summaryValues = after
        this.placed = true
        this.values = this.editable(after)
        this.phase = { kind: "summary", status: "submitted" }
      } else {
        this.error = failure
      }
    }, `${this.m.sendFailed}: `)
  }

  private async deliver(bridge: Bridge, result: ToolResult): Promise<string | undefined> {
    const message = result.structuredContent as
      | { readonly text?: unknown; readonly attachment?: { readonly uri: string; readonly name: string } }
      | undefined
    if (typeof message?.text !== "string" || message.attachment === undefined) {
      return undefined
    }
    const placed = await bridge.placeMessage([
      { type: "text", text: message.text },
      { type: "resource_link", uri: message.attachment.uri, name: message.attachment.name, mimeType: "application/json" }
    ])
    if (!placed) {
      return this.m.openConversation
    }
    return undefined
  }

  private answered(values: Values): Values {
    return this.form === undefined ? values : answerValues(this.form.spec, values)
  }

  private editable(values: Values): Record<string, FieldValue> {
    return { ...this.guesses, ...this.remembered, ...values }
  }

  private changedSinceAnswer(): ReadonlyArray<string> {
    return this.form === undefined ? [] : changedFields(this.form.spec, this.baseline, this.values)
  }

  private setValue(id: string, value: FieldValue): void {
    this.values[id] = value
    this.refresh()
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
    this.live.computed = undefined
    this.live.status = undefined
    this.live.primary = undefined
    this.live.form = undefined
    this.root.replaceChildren(this.view())
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
      case "resending":
        return this.formView(phase.kind)
    }
  }

  private formView(mode: "answering" | "resending"): HTMLElement {
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
        h("h1", { id: titleId }, mode === "resending" ? `${spec.title}` : spec.title),
        spec.description === undefined ? null : h("p", { class: "description" }, spec.description)
      ),
      h(
        "div",
        { class: "fields" },
        basic.map((field) => this.fieldView(field))
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
              advanced.map((field) => this.fieldView(field))
            )
          ),
      (spec.computed ?? []).length === 0 ? null : this.computedView(),
      mode === "answering" ? this.answerFooter() : this.resendFooter()
    )
    this.live.form = element
    on(element, "submit", (event) => {
      event.preventDefault()
    })
    on(element, "keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        event.target?.dispatchEvent(new Event("change"))
        void (mode === "answering" ? this.answer("submit") : this.resend())
      } else if (event.key === "Escape" && mode === "resending" && !this.busy) {
        event.preventDefault()
        this.cancelResend()
      }
    })
    return element
  }

  private cancelResend(): void {
    this.values = this.editable(this.summaryValues)
    this.error = undefined
    this.phase = { kind: "summary", status: "submitted" }
    this.render()
  }

  private fieldView(field: Field): HTMLElement {
    return this.card(field, false)
  }

  private reveal(field: ChoiceField, option: ChoiceField["options"][number]): HTMLElement | null {
    if (!("fields" in option) || option.fields === undefined) {
      return null
    }
    const element = h(
      "div",
      { class: "reveal" },
      option.fields.map((nested) => this.card(nested, true))
    )
    this.live.branches.push({ id: field.id, value: option.value, element })
    return element
  }

  private card(field: Field, nested: boolean): HTMLElement {
    const labelId = uid("label")
    const answer = h("span", { class: "q-answer" })
    const toggle = hasDetails(field) ? h("button", { type: "button", class: "fold" }) : null
    const note = h("div", { class: "q-note" })
    const element = h(
      "section",
      { class: nested ? "q sub" : "q", "aria-labelledby": labelId },
      h(
        "div",
        { class: "q-head" },
        h("span", { class: "q-label", id: labelId }, field.label),
        answer,
        toggle,
        field.type === "toggle" ? this.control(field, labelId) : null
      ),
      field.type === "toggle" ? null : this.control(field, labelId),
      field.type === "choice" ? null : note
    )
    this.live.cards.push({ field, element, toggle, answer, note })
    if (toggle !== null) {
      on(toggle, "click", () => this.setFolded(field.id, !this.folded.has(field.id)))
      const unfold = (event: Event) => {
        const target = event.target as HTMLElement
        if (target !== toggle && target.closest(".q") === element) {
          this.setFolded(field.id, false)
        }
      }
      on(element, "pointerdown", unfold)
      on(element, "focusin", unfold)
    }
    return element
  }

  private control(field: Field, labelId: string): HTMLElement {
    switch (field.type) {
      case "text":
        return this.textView(field, labelId)
      case "number":
        return this.numberView(field, labelId)
      case "choice":
        return this.choiceView(field, labelId)
      case "toggle":
        return this.toggleView(field, labelId)
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
      if (card.toggle !== null) {
        const label = folded ? this.m.more : this.m.less
        card.toggle.setAttribute("aria-label", label)
        card.toggle.title = label
      }
    }
  }

  private textView(field: TextField, labelId: string): HTMLElement {
    const value = String(this.values[field.id] ?? "")
    const common = { name: field.id, "aria-labelledby": labelId, placeholder: field.placeholder }
    const input = field.multiline === true ? h("textarea", { ...common, rows: 3 }, value) : h("input", { ...common, type: "text", value })
    on(input, "input", () => this.setValue(field.id, input.value))
    return input
  }

  private numberView(field: NumberField, labelId: string): HTMLElement {
    const value = Number(this.values[field.id] ?? field.min)
    const step = field.step ?? "any"
    const text = (next: number) => `${field.prefix ?? ""}${formatNumber(next)}${field.suffix ?? ""}`
    const slider = h("input", {
      type: "range",
      min: field.min,
      max: field.max,
      step,
      value,
      "aria-labelledby": labelId,
      "aria-valuetext": text(value)
    })
    const exact = h("input", { type: "number", min: field.min, max: field.max, step, value, class: "exact", "aria-labelledby": labelId })
    const show = (next: number) => {
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
        exact.value = slider.value
      }
    })
    return h("div", { class: "row" }, slider, affix(field.prefix), exact, affix(field.suffix))
  }

  private choiceView(field: ChoiceField, labelId: string): HTMLElement {
    const multiple = field.multiple === true
    const recommended = field.default === undefined ? [] : Array.isArray(field.default) ? field.default : [field.default]
    const name = uid(field.id)
    const current = this.values[field.id]
    let pointing = false
    const options = field.options.flatMap((option) => {
      const checked = multiple ? Array.isArray(current) && current.includes(option.value) : current === option.value
      const input = h("input", { type: multiple ? "checkbox" : "radio", name, value: option.value, checked })
      on(input, "change", () => {
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
      const isRecommended = recommended.includes(option.value)
      const row = h(
        "label",
        { class: isRecommended ? "option recommended" : "option" },
        input,
        h(
          "span",
          { class: "option-text" },
          h("span", { class: "option-head" }, option.label, isRecommended ? h("span", { class: "badge" }, this.m.recommended) : null),
          option.description === undefined ? null : h("span", { class: "option-summary" }, option.description),
          option.details === undefined ? null : h("span", { class: "option-details" }, option.details),
          isRecommended ? optionWhyView(field, this.m) : null
        )
      )
      const revealed = this.reveal(field, option)
      return revealed === null ? [row] : [row, revealed]
    })
    const group = h("div", { class: "options", role: multiple ? "group" : "radiogroup", "aria-labelledby": labelId }, options)
    on(group, "pointerdown", () => {
      pointing = true
    })
    on(group, "keydown", () => {
      pointing = false
    })
    return group
  }

  private toggleView(field: ToggleField, labelId: string): HTMLElement {
    const input = h("input", { type: "checkbox", role: "switch", checked: this.values[field.id] === true, "aria-labelledby": labelId })
    on(input, "change", () => this.setValue(field.id, input.checked))
    return h("div", { class: "row" }, input, h("span", { class: "muted" }, field.note ?? ""))
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
      this.form?.spec.submitLabel ?? this.m.submit,
      () => void this.answer("submit"),
      [this.ghost(this.m.delegate, () => void this.answer("delegate")), this.ghost(this.m.answerInChat, () => void this.answer("chat"))],
      [h("kbd", { class: "shortcut", "aria-hidden": "true" }, "⌘/Ctrl ⏎")]
    )
  }

  private resendFooter(): HTMLElement {
    return this.footer(this.m.resend, () => void this.resend(), [this.ghost(this.m.cancel, () => this.cancelResend())], [])
  }

  private summary(status: Status): HTMLElement {
    const form = this.form
    const title = status === "submitted" ? this.m.answered : status === "delegated" ? this.m.delegated : this.m.answeredInChat
    const head = h(
      "div",
      { class: "summary-head" },
      h("span", { class: "check", "aria-hidden": "true" }, "✓"),
      h("span", {}, title),
      form === undefined || status === "answer_in_chat"
        ? null
        : on(h("button", { type: "button", class: "link" }, this.m.editAndResend), "click", () => {
            this.phase = { kind: "resending" }
            this.folded.clear()
            for (const field of allFields(this.form?.spec ?? { title: "", fields: [] })) {
              this.folded.add(field.id)
            }
            this.render()
          })
    )
    if (form === undefined || status === "answer_in_chat") {
      return h("section", { class: "card summary", role: "status" }, head)
    }
    const changedByUser = changedFields(form.spec, this.guesses, this.summaryValues)
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
            ? h("span", { class: "mark" }, this.m.recommendedWas(describeValue(field, this.guesses[field.id], this.m)))
            : null
        )
      )
    )
    return h(
      "section",
      { class: "card summary" },
      head,
      h("dl", {}, rows),
      this.placed ? h("p", { class: "notice", role: "status" }, this.m.placed) : null,
      this.error === undefined ? null : h("p", { class: "error", role: "alert" }, this.error)
    )
  }

  private refreshCards(sinceAnswer: ReadonlyArray<string>): void {
    if (this.form === undefined) {
      return
    }
    const sinceRecommended = changedFields(this.form.spec, this.guesses, this.values)
    for (const card of this.live.cards) {
      const field = card.field
      const changed = sinceRecommended.includes(field.id)
      card.answer.replaceChildren(this.answerTag(field, changed, sinceAnswer.includes(field.id)) ?? "")
      if (field.type !== "choice") {
        card.note.replaceChildren(...[this.backView(field, changed), whyView(field, this.m.whyRecommended)].filter((node) => node !== null))
      }
    }
  }

  private recommendedText(field: Field): string | undefined {
    return field.default === undefined ? undefined : describeValue(field, this.guesses[field.id], this.m)
  }

  private answerTag(field: Field, changed: boolean, changedSinceAnswer: boolean): HTMLElement | null {
    if (this.phase.kind === "resending") {
      return changedSinceAnswer
        ? h("span", { class: "muted" }, this.m.previously(describeValue(field, this.baseline[field.id], this.m)))
        : null
    }
    const recommended = this.recommendedText(field)
    if (recommended === undefined) {
      return null
    }
    return changed ? h("span", { class: "muted" }, this.m.recommendedWas(recommended)) : null
  }

  private backView(field: Field, changed: boolean): HTMLElement | null {
    const recommended = this.recommendedText(field)
    if (recommended === undefined || !changed) {
      return null
    }
    const back = on(h("button", { type: "button", class: "link" }, this.m.backToRecommended), "click", () => {
      this.values[field.id] = this.guesses[field.id] as FieldValue
      this.render()
    })
    return h("p", { class: "back" }, h("span", {}, this.m.recommendedWas(recommended)), back)
  }

  private refreshComputed(form: CompiledForm): void {
    const values = computeValues(form, this.values)
    const items = (form.spec.computed ?? []).map((item) =>
      h(
        "div",
        { class: item.primary === true ? "metric primary" : "metric" },
        h("span", { class: "metric-label" }, item.label),
        h("span", { class: "metric-value" }, describeComputed(item, values[item.id], this.m))
      )
    )
    this.live.computed?.replaceChildren(...items)
  }

  private statusText(sinceAnswer: ReadonlyArray<string>): string {
    if (this.error !== undefined) {
      return this.error
    }
    if (this.busy) {
      return this.m.sending
    }
    if (this.phase.kind !== "resending") {
      return ""
    }
    return sinceAnswer.length === 0 ? this.m.noChanges : this.m.changedCount(sinceAnswer.length)
  }

  private refresh(): void {
    const form = this.form
    if (form === undefined) {
      return
    }
    const sinceAnswer = this.changedSinceAnswer()
    for (const branch of this.live.branches) {
      branch.element.hidden = this.values[branch.id] !== branch.value
    }
    this.refreshCards(sinceAnswer)
    this.refreshComputed(form)
    if (this.live.status !== undefined) {
      this.live.status.textContent = this.statusText(sinceAnswer)
      this.live.status.classList.toggle("error", this.error !== undefined)
    }
    if (this.live.form !== undefined) {
      this.live.form.inert = this.busy
    }
    if (this.live.primary !== undefined) {
      this.live.primary.disabled = this.busy || (this.phase.kind === "resending" && sinceAnswer.length === 0)
    }
  }
}
