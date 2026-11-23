export interface BranchOption {
  readonly value: string
  readonly row: HTMLElement
  readonly control: HTMLElement
  readonly selected: boolean
}

export interface BranchFollowUp {
  readonly id: string
  readonly card: HTMLElement
  readonly label: HTMLElement
  readonly anyOf: ReadonlyArray<string>
}

export interface BranchLane {
  readonly depth: number
  readonly anchor: HTMLElement
  readonly options: ReadonlyArray<BranchOption>
  readonly followUps: ReadonlyArray<BranchFollowUp>
}

export interface PlacedOption<R> {
  readonly value: string
  readonly selected: boolean
  readonly x: number
  readonly y: number
  readonly ref: R
}

export interface PlacedFollowUp {
  readonly id: string
  readonly anyOf: ReadonlyArray<string>
  readonly x: number
  readonly y: number
}

export interface PlacedLane<R> {
  readonly depth: number
  readonly anchorY: number
  readonly options: ReadonlyArray<PlacedOption<R>>
  readonly followUps: ReadonlyArray<PlacedFollowUp>
}

export type Shape =
  | { readonly kind: "path"; readonly lit: boolean; readonly d: string }
  | { readonly kind: "dot"; readonly lit: boolean; readonly filled: boolean; readonly x: number; readonly y: number }

export interface Branches<R> {
  readonly shapes: ReadonlyArray<Shape>
  readonly revealing: ReadonlyArray<R>
}

const laneBase = 10

const laneStep = 12

const corner = 6

const dotRadius = 3.5

export const gutterFor = (depth: number): number => laneBase + depth * laneStep + 16

const curve = (x: number, end: PlacedFollowUp): string => `V ${end.y - corner} Q ${x} ${end.y} ${x + corner} ${end.y} H ${end.x}`

const railShapes = <R>(x: number, lane: PlacedLane<R>, firing: ReadonlyArray<PlacedOption<R>>): ReadonlyArray<Shape> => {
  const last = lane.followUps.at(-1)
  if (last === undefined) {
    return []
  }
  const top = Math.min(...(firing.length === 0 ? [lane.anchorY] : firing.map((option) => option.y)))
  return [
    { kind: "path", lit: false, d: `M ${x} ${top} ${curve(x, last)}` },
    ...lane.followUps.slice(0, -1).map((end): Shape => ({ kind: "path", lit: false, d: `M ${x} ${end.y} H ${end.x}` })),
    ...firing.map((option): Shape => ({ kind: "path", lit: false, d: `M ${x} ${option.y} H ${option.x}` }))
  ]
}

const litShapes = <R>(x: number, target: PlacedFollowUp, options: ReadonlyArray<PlacedOption<R>>): ReadonlyArray<Shape> =>
  options.flatMap((option): ReadonlyArray<Shape> => [
    { kind: "path", lit: true, d: `M ${option.x} ${option.y} H ${x} ${curve(x, target)}` },
    { kind: "dot", lit: true, filled: true, x, y: option.y }
  ])

export const branchShapes = <R>(lanes: ReadonlyArray<PlacedLane<R>>, hot?: string): Branches<R> => {
  const rails: Array<Shape> = []
  const lit: Array<Shape> = []
  const revealing: Array<R> = []
  for (const lane of lanes) {
    const x = laneBase + lane.depth * laneStep
    const firing = lane.options.filter(
      (option) => option.selected && lane.followUps.some((followUp) => followUp.anyOf.includes(option.value))
    )
    rails.push(
      ...railShapes(x, lane, firing),
      ...lane.options.map((option): Shape => ({ kind: "dot", lit: false, filled: firing.includes(option), x, y: option.y }))
    )
    const target = lane.followUps.find((followUp) => followUp.id === hot)
    if (target !== undefined) {
      const sources = firing.filter((option) => target.anyOf.includes(option.value))
      revealing.push(...sources.map((option) => option.ref))
      lit.push(...litShapes(x, target, sources))
    }
  }
  return { shapes: [...rails, ...lit], revealing }
}

const svgElement = (tag: string, attributes: Readonly<Record<string, string | number>>): SVGElement => {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag)
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value))
  }
  return element
}

export const branchCanvas = (): SVGElement => svgElement("svg", { class: "branches", "aria-hidden": "true", focusable: "false" })

const dotClass = (shape: { readonly lit: boolean; readonly filled: boolean }): string =>
  shape.lit ? "dot lit" : shape.filled ? "dot" : "dot hollow"

const shapeElement = (shape: Shape): SVGElement =>
  shape.kind === "path"
    ? svgElement("path", { class: shape.lit ? "rail lit" : "rail", d: shape.d })
    : svgElement("circle", { class: dotClass(shape), cx: shape.x, cy: shape.y, r: dotRadius })

const place = (container: HTMLElement, lanes: ReadonlyArray<BranchLane>): ReadonlyArray<PlacedLane<BranchOption>> => {
  const box = container.getBoundingClientRect()
  const middle = (element: Element): number => {
    const rect = element.getBoundingClientRect()
    return rect.top + rect.height / 2 - box.top
  }
  const left = (element: Element): number => element.getBoundingClientRect().left - box.left
  return lanes.map((lane) => ({
    depth: lane.depth,
    anchorY: middle(lane.anchor),
    options: lane.options
      .filter((option) => option.row.getClientRects().length > 0)
      .map((option) => ({
        value: option.value,
        selected: option.selected,
        x: left(option.control) - 5,
        y: middle(option.control),
        ref: option
      })),
    followUps: lane.followUps.map((followUp) => ({
      id: followUp.id,
      anyOf: followUp.anyOf,
      x: left(followUp.label) - 6,
      y: middle(followUp.label)
    }))
  }))
}

export const drawBranches = (
  container: HTMLElement,
  canvas: SVGElement,
  lanes: ReadonlyArray<BranchLane>,
  hot: string | undefined
): void => {
  const { shapes, revealing } = branchShapes(place(container, lanes), hot)
  for (const element of container.querySelectorAll(".hot, .revealing")) {
    element.classList.remove("hot", "revealing")
  }
  for (const option of revealing) {
    option.row.classList.add("revealing")
  }
  for (const lane of lanes) {
    lane.followUps.find((followUp) => followUp.id === hot)?.card.classList.add("hot")
  }
  canvas.replaceChildren(...shapes.map((shape) => shapeElement(shape)))
  canvas.classList.toggle("dimmed", revealing.length > 0)
}
