export type Value = number | string | boolean

export type Expr =
  | { readonly kind: "literal"; readonly value: Value }
  | { readonly kind: "ref"; readonly name: string }
  | { readonly kind: "unary"; readonly op: "-" | "!"; readonly operand: Expr }
  | { readonly kind: "binary"; readonly op: BinaryOp; readonly left: Expr; readonly right: Expr }
  | { readonly kind: "conditional"; readonly test: Expr; readonly whenTrue: Expr; readonly whenFalse: Expr }
  | { readonly kind: "call"; readonly name: FunctionName; readonly args: ReadonlyArray<Expr> }

type BinaryOp = "+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "&&" | "||"
type FunctionName = "min" | "max" | "abs" | "floor" | "ceil" | "round"

interface ParseError {
  readonly message: string
  readonly position: number
}

export type ParseResult = { readonly ok: true; readonly expr: Expr } | { readonly ok: false; readonly error: ParseError }

type Token =
  | { readonly kind: "number"; readonly value: number; readonly position: number }
  | { readonly kind: "string"; readonly value: string; readonly position: number }
  | { readonly kind: "ident"; readonly value: string; readonly position: number }
  | { readonly kind: "op"; readonly value: string; readonly position: number }
  | { readonly kind: "end"; readonly position: number }

const functionNames: ReadonlySet<string> = new Set(["min", "max", "abs", "floor", "ceil", "round"])
const operators = ["<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "!", "?", ":", "(", ")", ","]

class Failure extends Error {
  readonly detail: ParseError

  constructor(detail: ParseError) {
    super(detail.message)
    this.detail = detail
  }
}

const fail = (message: string, position: number): never => {
  throw new Failure({ message, position })
}

type Scanned = { readonly token: Token; readonly length: number } | undefined

const matching = (pattern: RegExp, source: string, at: number, make: (text: string) => Token): Scanned => {
  const match = pattern.exec(source.slice(at))
  return match === null ? undefined : { token: make(match[0]), length: match[0].length }
}

const scanString = (source: string, at: number): Scanned => {
  const quote = source.charAt(at)
  if (quote !== '"' && quote !== "'") {
    return undefined
  }
  const end = source.indexOf(quote, at + 1)
  if (end === -1) {
    fail("文字列が閉じられていません", at)
  }
  return { token: { kind: "string", value: source.slice(at + 1, end), position: at }, length: end + 1 - at }
}

const scanOperator = (source: string, at: number): Scanned => {
  const op = operators.find((candidate) => source.startsWith(candidate, at))
  return op === undefined ? undefined : { token: { kind: "op", value: op, position: at }, length: op.length }
}

const scanners: ReadonlyArray<(source: string, at: number) => Scanned> = [
  (source, at) =>
    matching(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, source, at, (text) => ({ kind: "number", value: Number(text), position: at })),
  (source, at) => matching(/^[A-Za-z_][A-Za-z0-9_]*/, source, at, (text) => ({ kind: "ident", value: text, position: at })),
  scanString,
  scanOperator
]

const scan = (source: string, at: number): Scanned => {
  for (const scanner of scanners) {
    const scanned = scanner(source, at)
    if (scanned !== undefined) {
      return scanned
    }
  }
  return fail(`使えない文字「${source.charAt(at)}」があります`, at)
}

const tokenize = (source: string): ReadonlyArray<Token> => {
  const tokens: Array<Token> = []
  let i = 0
  while (i < source.length) {
    if (/\s/.test(source.charAt(i))) {
      i++
    } else {
      const scanned = scan(source, i)
      if (scanned !== undefined) {
        tokens.push(scanned.token)
        i += scanned.length
      }
    }
  }
  tokens.push({ kind: "end", position: source.length })
  return tokens
}

class Parser {
  private index = 0
  private readonly tokens: ReadonlyArray<Token>

  constructor(tokens: ReadonlyArray<Token>) {
    this.tokens = tokens
  }

  parse(): Expr {
    const expr = this.conditional()
    const next = this.peek()
    if (next.kind !== "end") {
      fail("式の後に余分な字句があります", next.position)
    }
    return expr
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { kind: "end", position: 0 }
  }

  private advance(): Token {
    const token = this.peek()
    this.index++
    return token
  }

  private isOp(value: string): boolean {
    const token = this.peek()
    return token.kind === "op" && token.value === value
  }

  private expectOp(value: string): void {
    const token = this.advance()
    if (token.kind !== "op" || token.value !== value) {
      fail(`「${value}」が必要です`, token.position)
    }
  }

  private conditional(): Expr {
    const test = this.or()
    if (!this.isOp("?")) {
      return test
    }
    this.advance()
    const whenTrue = this.conditional()
    this.expectOp(":")
    const whenFalse = this.conditional()
    return { kind: "conditional", test, whenTrue, whenFalse }
  }

  private binaryLevel(next: () => Expr, ops: ReadonlyArray<BinaryOp>): Expr {
    let left = next()
    for (;;) {
      const token = this.peek()
      const op = token.kind === "op" ? ops.find((candidate) => candidate === token.value) : undefined
      if (op === undefined) {
        return left
      }
      this.advance()
      left = { kind: "binary", op, left, right: next() }
    }
  }

  private or(): Expr {
    return this.binaryLevel(() => this.and(), ["||"])
  }

  private and(): Expr {
    return this.binaryLevel(() => this.equality(), ["&&"])
  }

  private equality(): Expr {
    return this.binaryLevel(() => this.comparison(), ["==", "!="])
  }

  private comparison(): Expr {
    return this.binaryLevel(() => this.additive(), ["<=", ">=", "<", ">"])
  }

  private additive(): Expr {
    return this.binaryLevel(() => this.multiplicative(), ["+", "-"])
  }

  private multiplicative(): Expr {
    return this.binaryLevel(() => this.unary(), ["*", "/", "%"])
  }

  private unary(): Expr {
    if (this.isOp("-") || this.isOp("!")) {
      const token = this.advance()
      const op = token.kind === "op" && token.value === "!" ? "!" : "-"
      return { kind: "unary", op, operand: this.unary() }
    }
    return this.primary()
  }

  private primary(): Expr {
    const token = this.advance()
    switch (token.kind) {
      case "number":
        return { kind: "literal", value: token.value }
      case "string":
        return { kind: "literal", value: token.value }
      case "ident":
        return this.identifier(token.value, token.position)
      case "op":
        if (token.value === "(") {
          const inner = this.conditional()
          this.expectOp(")")
          return inner
        }
        return fail(`「${token.value}」はここに置けません`, token.position)
      case "end":
        return fail("式が途中で終わっています", token.position)
    }
  }

  private identifier(name: string, position: number): Expr {
    if (name === "true" || name === "false") {
      return { kind: "literal", value: name === "true" }
    }
    if (!this.isOp("(")) {
      return { kind: "ref", name }
    }
    if (!functionNames.has(name)) {
      fail(`関数「${name}」は使えません`, position)
    }
    this.advance()
    const args: Array<Expr> = []
    if (!this.isOp(")")) {
      args.push(this.conditional())
      while (this.isOp(",")) {
        this.advance()
        args.push(this.conditional())
      }
    }
    this.expectOp(")")
    return { kind: "call", name: name as FunctionName, args }
  }
}

export const parse = (source: string): ParseResult => {
  try {
    return { ok: true, expr: new Parser(tokenize(source)).parse() }
  } catch (error) {
    if (error instanceof Failure) {
      return { ok: false, error: error.detail }
    }
    throw error
  }
}

export const references = (expr: Expr): ReadonlyArray<string> => {
  switch (expr.kind) {
    case "literal":
      return []
    case "ref":
      return [expr.name]
    case "unary":
      return references(expr.operand)
    case "binary":
      return [...references(expr.left), ...references(expr.right)]
    case "conditional":
      return [...references(expr.test), ...references(expr.whenTrue), ...references(expr.whenFalse)]
    case "call":
      return expr.args.flatMap(references)
  }
}

export type Scope = ReadonlyMap<string, Value | undefined>

const numeric = (value: Value | undefined): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const finite = (value: number): number | undefined => (Number.isFinite(value) ? value : undefined)

const arithmetic = (op: BinaryOp, a: number, b: number): number | undefined => {
  switch (op) {
    case "+":
      return finite(a + b)
    case "-":
      return finite(a - b)
    case "*":
      return finite(a * b)
    case "/":
      return b === 0 ? undefined : finite(a / b)
    case "%":
      return b === 0 ? undefined : finite(a % b)
    default:
      return undefined
  }
}

const compare = (op: BinaryOp, a: Value, b: Value): boolean | undefined => {
  if (op === "==") {
    return a === b
  }
  if (op === "!=") {
    return a !== b
  }
  if (typeof a !== "number" || typeof b !== "number") {
    return undefined
  }
  switch (op) {
    case "<":
      return a < b
    case "<=":
      return a <= b
    case ">":
      return a > b
    case ">=":
      return a >= b
    default:
      return undefined
  }
}

const unaryFunctions: Readonly<Record<"abs" | "floor" | "ceil", (x: number) => number>> = {
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil
}

const round = (args: ReadonlyArray<number>): number | undefined => {
  const [value, digits = 0] = args
  if (value === undefined || args.length > 2) {
    return undefined
  }
  const factor = 10 ** digits
  return finite(Math.round(value * factor) / factor)
}

const callFunction = (name: FunctionName, args: ReadonlyArray<number>): number | undefined => {
  if (name === "min" || name === "max") {
    return args.length === 0 ? undefined : Math[name](...args)
  }
  if (name === "round") {
    return round(args)
  }
  const [value] = args
  return args.length === 1 && value !== undefined ? unaryFunctions[name](value) : undefined
}

type Of<K extends Expr["kind"]> = Extract<Expr, { readonly kind: K }>

const evaluateUnary = (expr: Of<"unary">, scope: Scope): Value | undefined => {
  const operand = evaluate(expr.operand, scope)
  if (expr.op === "!") {
    return typeof operand === "boolean" ? !operand : undefined
  }
  const n = numeric(operand)
  return n === undefined ? undefined : -n
}

const evaluateLogical = (expr: Of<"binary">, scope: Scope): Value | undefined => {
  const left = evaluate(expr.left, scope)
  if (typeof left !== "boolean") {
    return undefined
  }
  if (expr.op === "&&" ? !left : left) {
    return left
  }
  const right = evaluate(expr.right, scope)
  return typeof right === "boolean" ? right : undefined
}

const comparisons: ReadonlySet<BinaryOp> = new Set(["<", "<=", ">", ">=", "==", "!="])

const evaluateBinary = (expr: Of<"binary">, scope: Scope): Value | undefined => {
  if (expr.op === "&&" || expr.op === "||") {
    return evaluateLogical(expr, scope)
  }
  const left = evaluate(expr.left, scope)
  const right = evaluate(expr.right, scope)
  if (left === undefined || right === undefined) {
    return undefined
  }
  if (comparisons.has(expr.op)) {
    return compare(expr.op, left, right)
  }
  const a = numeric(left)
  const b = numeric(right)
  return a === undefined || b === undefined ? undefined : arithmetic(expr.op, a, b)
}

const evaluateConditional = (expr: Of<"conditional">, scope: Scope): Value | undefined => {
  const test = evaluate(expr.test, scope)
  return typeof test === "boolean" ? evaluate(test ? expr.whenTrue : expr.whenFalse, scope) : undefined
}

const evaluateCall = (expr: Of<"call">, scope: Scope): Value | undefined => {
  const args = expr.args.map((arg) => numeric(evaluate(arg, scope)))
  const numbers = args.filter((arg): arg is number => arg !== undefined)
  return numbers.length === args.length ? callFunction(expr.name, numbers) : undefined
}

export const evaluate = (expr: Expr, scope: Scope): Value | undefined => {
  switch (expr.kind) {
    case "literal":
      return typeof expr.value === "number" ? finite(expr.value) : expr.value
    case "ref":
      return scope.get(expr.name)
    case "unary":
      return evaluateUnary(expr, scope)
    case "binary":
      return evaluateBinary(expr, scope)
    case "conditional":
      return evaluateConditional(expr, scope)
    case "call":
      return evaluateCall(expr, scope)
  }
}
