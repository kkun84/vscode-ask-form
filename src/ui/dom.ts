type Child = Node | string | null | undefined | false
type Attributes = Readonly<Record<string, string | number | boolean | undefined>>

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: ReadonlyArray<Child | ReadonlyArray<Child>>
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) {
      continue
    }
    element.setAttribute(name, value === true ? "" : String(value))
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) {
      continue
    }
    element.append(child)
  }
  return element
}

export const on = <E extends HTMLElement, K extends keyof HTMLElementEventMap>(
  element: E,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void
): E => {
  element.addEventListener(type, listener)
  return element
}

let counter = 0
export const uid = (prefix: string): string => `${prefix}-${++counter}`
