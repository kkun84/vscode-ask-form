import { maxListItemLength, maxListItems } from "../core/form.ts"
import type { Messages } from "../core/messages.ts"
import { h, uid } from "./dom.ts"

interface Token {
  readonly type: string
  readonly value: string
  readonly label: string
}

type TokenValue = ReadonlyArray<string | Token>

interface ListControl {
  readonly element: HTMLElement
  readonly set: (items: ReadonlyArray<string>) => void
}

interface ListOptions {
  readonly items: ReadonlyArray<string>
  readonly labelId: string
  readonly describedBy: string
  readonly placeholder: string | undefined
  readonly m: Messages
  readonly onChange: (items: ReadonlyArray<string>) => void
}

const token = (text: string): Token => ({ type: "item", value: text, label: text })

const itemsOf = (value: TokenValue): ReadonlyArray<string> => value.flatMap((part) => (typeof part === "string" ? [] : [part.value]))

const textOf = (value: TokenValue): string =>
  value
    .filter((part): part is string => typeof part === "string")
    .join("")
    .trim()

const problemOf = (text: string, items: ReadonlyArray<string>, m: Messages): string | undefined => {
  if (text.length > maxListItemLength) {
    return m.listTooLong(maxListItemLength)
  }
  if (items.includes(text)) {
    return m.listDuplicate(text)
  }
  return items.length >= maxListItems ? m.listFull(maxListItems) : undefined
}

export const listControl = (options: ListOptions): ListControl => {
  const { m } = options
  const hintId = uid("hint")
  const errorId = uid("error")
  const editor = h("ui-token-input-editor", {
    class: "list-editor",
    placeholder: options.placeholder ?? m.listPlaceholder,
    "aria-labelledby": options.labelId,
    "aria-describedby": [hintId, errorId, options.describedBy].join(" ").trim()
  })
  const template = document.createElement("template")
  template.innerHTML =
    '<ui-token-input-token class="list-item"><span data-token-label></span><ui-token-input-token-remove class="list-remove">×</ui-token-input-token-remove></ui-token-input-token>'
  const input = h("ui-token-input", { class: "list-input", "submit-shortcut": "mod+enter", "token-deletion": "whole" }, editor, template)
  const error = h("p", { class: "list-error", id: errorId, "aria-live": "polite" })
  let items = [...options.items]
  input.defaultValue = items.map((item) => token(item))
  const commit = () => {
    const value = input.api?.getValue() ?? []
    const text = textOf(value)
    if (text === "") {
      return
    }
    const problem = problemOf(text, itemsOf(value), m)
    error.textContent = problem ?? ""
    if (problem === undefined) {
      input.api?.setValue([...itemsOf(value).map((item) => token(item)), token(text)])
    }
  }
  input.addEventListener("valuechange", (event) => {
    const next = itemsOf((event as CustomEvent<{ readonly value: TokenValue }>).detail.value)
    if (next.length !== items.length || next.some((item, index) => item !== items[index])) {
      items = [...next]
      options.onChange(items)
    }
  })
  input.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" && !event.isComposing && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        event.stopPropagation()
        commit()
      }
    },
    { capture: true }
  )
  input.addEventListener("focusout", commit)
  editor.addEventListener("change", commit)
  return {
    element: h("div", { class: "list-box" }, input, h("p", { class: "q-desc list-hint", id: hintId }, m.listHint), error),
    set: (next) => {
      error.textContent = ""
      input.api?.setValue(next.map((item) => token(item)))
    }
  }
}
