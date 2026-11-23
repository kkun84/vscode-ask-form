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

const laneBase = 8

const laneStep = 10

const corner = 8

const dotRadius = 3

export const gutterFor = (depth: number): number => laneBase + depth * laneStep + 12

const turnRight = (x: number, end: PlacedFollowUp): string => `Q ${x} ${end.y} ${x + corner} ${end.y} H ${end.x}`

const into = (x: number, end: PlacedFollowUp): string => `V ${end.y - corner} ${turnRight(x, end)}`

const outOf = <R>(x: number, option: PlacedOption<R>): string =>
  `M ${option.x} ${option.y} H ${x + corner} Q ${x} ${option.y} ${x} ${option.y + corner}`

const railShapes = <R>(x: number, lane: PlacedLane<R>, firing: ReadonlyArray<PlacedOption<R>>): ReadonlyArray<Shape> => {
  const last = lane.followUps.at(-1)
  if (last === undefined) {
    return []
  }
  const top = firing.length === 0 ? lane.anchorY : Math.min(...firing.map((option) => option.y)) + corner
  return [
    { kind: "path", lit: false, d: `M ${x} ${top} ${into(x, last)}` },
    ...lane.followUps.slice(0, -1).map((end): Shape => ({ kind: "path", lit: false, d: `M ${x} ${end.y - corner} ${turnRight(x, end)}` })),
    ...firing.map((option): Shape => ({ kind: "path", lit: false, d: outOf(x, option) }))
  ]
}

const litShapes = <R>(x: number, target: PlacedFollowUp, options: ReadonlyArray<PlacedOption<R>>): ReadonlyArray<Shape> =>
  options.flatMap((option): ReadonlyArray<Shape> => [
    { kind: "path", lit: true, d: `${outOf(x, option)} ${into(x, target)}` },
    { kind: "dot", lit: true, filled: true, x: option.x, y: option.y }
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
      ...lane.options.map((option): Shape => ({ kind: "dot", lit: false, filled: firing.includes(option), x: option.x, y: option.y }))
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

const visibleIn = (row: HTMLElement): { readonly top: number; readonly bottom: number } | undefined => {
  if (row.getClientRects().length === 0) {
    return undefined
  }
  const scroller = row.closest<HTMLElement>(".options.search")
  return scroller === null ? { top: -Infinity, bottom: Infinity } : scroller.getBoundingClientRect()
}

const middle = (element: Element): number => {
  const rect = element.getBoundingClientRect()
  return rect.top + rect.height / 2
}

const place = (container: HTMLElement, lanes: ReadonlyArray<BranchLane>): ReadonlyArray<PlacedLane<BranchOption>> => {
  const box = container.getBoundingClientRect()
  const left = (element: Element): number => element.getBoundingClientRect().left - box.left
  return lanes.map((lane) => ({
    depth: lane.depth,
    anchorY: middle(lane.anchor) - box.top,
    options: lane.options.flatMap((option) => {
      const view = visibleIn(option.row)
      const y = middle(option.control)
      const inView = view !== undefined && y >= view.top && y <= view.bottom
      const picked = option.row.closest(".search-choice")?.querySelector(".picked")
      if (!inView && !(option.selected && picked !== null && picked !== undefined)) {
        return []
      }
      const panel = option.row.closest(".q-group") ?? option.row
      return [
        {
          value: option.value,
          selected: option.selected,
          x: left(panel),
          y: (inView || picked === null || picked === undefined ? y : middle(picked)) - box.top,
          ref: option
        }
      ]
    }),
    followUps: lane.followUps.map((followUp) => ({
      id: followUp.id,
      anyOf: followUp.anyOf,
      x: left(followUp.label) - 6,
      y: middle(followUp.label) - box.top
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
