import {
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

type Status = "submitted" | "delegated" | "answer_in_chat"

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "answering" }
  | { readonly kind: "summary"; readonly status: Status }
  | { readonly kind: "resending" }
  | { readonly kind: "closed"; readonly reason: "cancelled" | "expired" }

type Action = "submit" | "delegate" | "chat"

const isStatus = (value: unknown): value is Status => value === "submitted" || value === "delegated" || value === "answer_in_chat"

const resultText = (result: ToolResult): string => (result.content ?? []).map((item) => item.text ?? "").join("\n")

const isExpired = (result: ToolResult): boolean => result.isError === true && /expired/.test(resultText(result))

export class FormApp {
  private phase: Phase = { kind: "loading" }
  private m: Messages = messages("en")
  private locale: string | undefined
  private form: CompiledForm | undefined
  private rawSpec: Readonly<Record<string, unknown>> = {}
  private values: Record<string, FieldValue> = {}
  private guesses: Values = {}
  private sent: Values = {}
  private busy = false
  private error: string | undefined
  private bridge: Bridge | undefined
  private readonly live = {
    hints: new Map<string, HTMLElement>(),
    computed: undefined as HTMLElement | undefined,
    status: undefined as HTMLElement | undefined,
    primary: undefined as HTMLButtonElement | undefined
  }

  private readonly root: HTMLElement

  constructor(root: HTMLElement) {
    this.root = root
    this.render()
  }

  attach(bridge: Bridge): void {
    this.bridge = bridge
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
    this.values = { ...this.guesses }
    this.sent = this.guesses
    if (this.phase.kind === "loading") {
      this.phase = { kind: "answering" }
    }
    this.render()
  }

  setResult(result: ToolResult): void {
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
      this.sent = values as Values
      this.values = { ...(values as Values) }
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

  private async answer(action: Action): Promise<void> {
    const form = this.form
    if (form === undefined || this.bridge === undefined || this.busy) {
      return
    }
    this.busy = true
    this.error = undefined
    this.refresh()
    try {
      const result = await this.bridge.callTool("form_answer", {
        formKey: form.key,
        action,
        ...(action === "submit" ? { values: this.values } : {})
      })
      if (isExpired(result)) {
        this.phase = { kind: "closed", reason: "expired" }
      } else if (result.isError === true) {
        this.error = resultText(result)
      } else {
        this.sent = action === "delegate" ? this.guesses : { ...this.values }
        this.values = { ...this.sent }
        this.phase = {
          kind: "summary",
          status: action === "submit" ? "submitted" : action === "delegate" ? "delegated" : "answer_in_chat"
        }
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
      this.render()
    }
  }

  private async resend(): Promise<void> {
    const form = this.form
    if (form === undefined || this.bridge === undefined || this.busy || this.changedSinceSent().length === 0) {
      return
    }
    this.busy = true
    this.error = undefined
    this.refresh()
    try {
      const result = await this.bridge.callTool("form_resend", {
        spec: this.rawSpec,
        before: this.sent,
        after: this.values,
        ...(this.locale === undefined ? {} : { locale: this.locale })
      })
      if (result.isError === true) {
        this.error = `${this.m.sendFailed}: ${resultText(result)}`
      } else {
        this.sent = { ...this.values }
        this.phase = { kind: "summary", status: "submitted" }
      }
    } catch (error) {
      this.error = `${this.m.sendFailed}: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      this.busy = false
      this.render()
    }
  }

  private changedSinceSent(): ReadonlyArray<string> {
    return this.form === undefined ? [] : changedFields(this.form.spec, this.sent, this.values)
  }

  private setValue(id: string, value: FieldValue): void {
    this.values[id] = value
    this.refresh()
  }

  private render(): void {
    this.live.hints.clear()
    this.live.computed = undefined
    this.live.status = undefined
    this.live.primary = undefined
    this.root.replaceChildren(this.view())
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
    on(element, "submit", (event) => {
      event.preventDefault()
    })
    on(element, "keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void (mode === "answering" ? this.answer("submit") : this.resend())
      } else if (event.key === "Escape" && mode === "resending") {
        event.preventDefault()
        this.cancelResend()
      }
    })
    return element
  }

  private cancelResend(): void {
    this.values = { ...this.sent }
    this.error = undefined
    this.phase = { kind: "summary", status: "submitted" }
    this.render()
  }

  private hint(field: Field, hintId: string): HTMLElement {
    const element = h("p", { class: "hint", id: hintId })
    this.live.hints.set(field.id, element)
    return element
  }

  private fieldView(field: Field): HTMLElement {
    switch (field.type) {
      case "text":
        return this.textView(field)
      case "number":
        return this.numberView(field)
      case "choice":
        return this.choiceView(field)
      case "toggle":
        return this.toggleView(field)
    }
  }

  private textView(field: TextField): HTMLElement {
    const inputId = uid(field.id)
    const hintId = uid("hint")
    const value = String(this.values[field.id] ?? "")
    const common = { id: inputId, name: field.id, "aria-describedby": hintId, placeholder: field.placeholder }
    const input = field.multiline === true ? h("textarea", { ...common, rows: 3 }, value) : h("input", { ...common, type: "text", value })
    on(input, "input", () => this.setValue(field.id, input.value))
    return h("div", { class: "field" }, h("label", { for: inputId }, field.label), input, this.hint(field, hintId))
  }

  private numberView(field: NumberField): HTMLElement {
    const sliderId = uid(field.id)
    const hintId = uid("hint")
    const value = Number(this.values[field.id] ?? field.min)
    const step = field.step ?? "any"
    const output = h("output", { for: sliderId, class: "value" }, `${field.prefix ?? ""}${formatNumber(value)}${field.suffix ?? ""}`)
    const slider = h("input", {
      id: sliderId,
      type: "range",
      min: field.min,
      max: field.max,
      step,
      value,
      "aria-describedby": hintId,
      "aria-valuetext": output.textContent ?? ""
    })
    const exact = h("input", {
      type: "number",
      min: field.min,
      max: field.max,
      step,
      value,
      class: "exact",
      "aria-label": field.label
    })
    const show = (next: number) => {
      slider.value = String(next)
      const text = `${field.prefix ?? ""}${formatNumber(next)}${field.suffix ?? ""}`
      output.textContent = text
      slider.setAttribute("aria-valuetext", text)
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
    return h(
      "div",
      { class: "field" },
      h("div", { class: "row" }, h("label", { for: sliderId }, field.label), output),
      h("div", { class: "row" }, slider, exact),
      this.hint(field, hintId)
    )
  }

  private choiceView(field: ChoiceField): HTMLElement {
    const hintId = uid("hint")
    const multiple = field.multiple === true
    const compact = !multiple && field.options.length <= 4 && field.options.every((option) => option.description === undefined)
    const name = uid(field.id)
    const current = this.values[field.id]
    const options = field.options.map((option) => {
      const inputId = uid(field.id)
      const checked = multiple ? Array.isArray(current) && current.includes(option.value) : current === option.value
      const input = h("input", { id: inputId, type: multiple ? "checkbox" : "radio", name, value: option.value, checked })
      on(input, "change", () => {
        if (multiple) {
          const selected = Array.isArray(this.values[field.id]) ? [...(this.values[field.id] as ReadonlyArray<string>)] : []
          this.setValue(field.id, input.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))
        } else if (input.checked) {
          this.setValue(field.id, option.value)
        }
      })
      return h(
        "label",
        { for: inputId, class: "option" },
        input,
        h(
          "span",
          { class: "option-text" },
          h("span", {}, option.label),
          option.description === undefined ? null : h("span", { class: "muted" }, option.description)
        )
      )
    })
    return h(
      "fieldset",
      { class: "field", "aria-describedby": hintId },
      h("legend", {}, field.label),
      h("div", { class: compact ? "segments" : "options" }, options),
      this.hint(field, hintId)
    )
  }

  private toggleView(field: ToggleField): HTMLElement {
    const inputId = uid(field.id)
    const hintId = uid("hint")
    const input = h("input", {
      id: inputId,
      type: "checkbox",
      role: "switch",
      checked: this.values[field.id] === true,
      "aria-describedby": hintId
    })
    on(input, "change", () => this.setValue(field.id, input.checked))
    return h(
      "div",
      { class: "field toggle" },
      h(
        "div",
        { class: "row" },
        h("label", { for: inputId }, field.label),
        field.note === undefined ? null : h("span", { class: "muted" }, field.note),
        input
      ),
      this.hint(field, hintId)
    )
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
            this.render()
          })
    )
    if (form === undefined || status === "answer_in_chat") {
      return h("section", { class: "card summary", role: "status" }, head)
    }
    const changedByUser = changedFields(form.spec, this.guesses, this.sent)
    const rows = form.spec.fields.map((field) =>
      h(
        "div",
        { class: "summary-row" },
        h("dt", {}, field.label),
        h(
          "dd",
          {},
          describeValue(field, this.sent[field.id], this.m),
          changedByUser.includes(field.id) ? h("span", { class: "mark" }, this.m.changedByYou) : null
        )
      )
    )
    return h(
      "section",
      { class: "card summary" },
      head,
      h("dl", {}, rows),
      this.error === undefined ? null : h("p", { class: "error", role: "alert" }, this.error)
    )
  }

  private refresh(): void {
    const form = this.form
    if (form === undefined) {
      return
    }
    const resending = this.phase.kind === "resending"
    const sinceSent = this.changedSinceSent()
    const sinceGuess = changedFields(form.spec, this.guesses, this.values)
    for (const field of form.spec.fields) {
      const hint = this.live.hints.get(field.id)
      if (hint === undefined) {
        continue
      }
      if (resending) {
        hint.textContent = sinceSent.includes(field.id) ? this.m.changedSinceSent : ""
        hint.className = "hint changed"
      } else if (sinceGuess.includes(field.id)) {
        hint.textContent = this.m.changedByYou
        hint.className = "hint changed"
      } else {
        hint.textContent = field.reason === undefined ? "" : `${this.m.aiGuess}: ${field.reason}`
        hint.className = "hint"
      }
    }
    if (this.live.computed !== undefined) {
      const values = computeValues(form, this.values)
      const items = (form.spec.computed ?? []).map((item) =>
        h(
          "div",
          { class: item.primary === true ? "metric primary" : "metric" },
          h("span", { class: "metric-label" }, item.label),
          h("span", { class: "metric-value" }, describeComputed(item, values[item.id], this.m))
        )
      )
      this.live.computed.replaceChildren(...items)
    }
    if (this.live.status !== undefined) {
      this.live.status.textContent =
        this.error ??
        (this.busy ? this.m.sending : resending ? (sinceSent.length === 0 ? this.m.noChanges : this.m.changedCount(sinceSent.length)) : "")
      this.live.status.classList.toggle("error", this.error !== undefined)
    }
    if (this.live.primary !== undefined) {
      this.live.primary.disabled = this.busy || (resending && sinceSent.length === 0)
    }
  }
}
