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

const tokenize = (source: string): ReadonlyArray<Token> => {
  const tokens: Array<Token> = []
  let i = 0
  while (i < source.length) {
    const ch = source.charAt(i)
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const numberMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i))
    if (numberMatch !== null) {
      tokens.push({ kind: "number", value: Number(numberMatch[0]), position: i })
      i += numberMatch[0].length
      continue
    }
    const identMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))
    if (identMatch !== null) {
      tokens.push({ kind: "ident", value: identMatch[0], position: i })
      i += identMatch[0].length
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = source.indexOf(ch, i + 1)
      if (end === -1) {
        fail("文字列が閉じられていません", i)
      }
      tokens.push({ kind: "string", value: source.slice(i + 1, end), position: i })
      i = end + 1
      continue
    }
    const at = i
    const op = operators.find((candidate) => source.startsWith(candidate, at))
    if (op === undefined) {
      fail(`使えない文字「${ch}」があります`, i)
    } else {
      tokens.push({ kind: "op", value: op, position: i })
      i += op.length
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

const callFunction = (name: FunctionName, args: ReadonlyArray<number>): number | undefined => {
  const [first, second] = args
  switch (name) {
    case "min":
      return args.length === 0 ? undefined : Math.min(...args)
    case "max":
      return args.length === 0 ? undefined : Math.max(...args)
    case "abs":
      return args.length === 1 && first !== undefined ? Math.abs(first) : undefined
    case "floor":
      return args.length === 1 && first !== undefined ? Math.floor(first) : undefined
    case "ceil":
      return args.length === 1 && first !== undefined ? Math.ceil(first) : undefined
    case "round": {
      if (first === undefined || args.length > 2) {
        return undefined
      }
      const factor = 10 ** (second ?? 0)
      return finite(Math.round(first * factor) / factor)
    }
  }
}

export const evaluate = (expr: Expr, scope: Scope): Value | undefined => {
  switch (expr.kind) {
    case "literal":
      return expr.value
    case "ref":
      return scope.get(expr.name)
    case "unary": {
      const operand = evaluate(expr.operand, scope)
      if (expr.op === "!") {
        return typeof operand === "boolean" ? !operand : undefined
      }
      const n = numeric(operand)
      return n === undefined ? undefined : -n
    }
    case "binary": {
      const left = evaluate(expr.left, scope)
      if (expr.op === "&&" || expr.op === "||") {
        if (typeof left !== "boolean") {
          return undefined
        }
        if (expr.op === "&&" ? !left : left) {
          return left
        }
        const right = evaluate(expr.right, scope)
        return typeof right === "boolean" ? right : undefined
      }
      const right = evaluate(expr.right, scope)
      if (left === undefined || right === undefined) {
        return undefined
      }
      if (["<", "<=", ">", ">=", "==", "!="].includes(expr.op)) {
        return compare(expr.op, left, right)
      }
      const a = numeric(left)
      const b = numeric(right)
      return a === undefined || b === undefined ? undefined : arithmetic(expr.op, a, b)
    }
    case "conditional": {
      const test = evaluate(expr.test, scope)
      if (typeof test !== "boolean") {
        return undefined
      }
      return evaluate(test ? expr.whenTrue : expr.whenFalse, scope)
    }
    case "call": {
      const args = expr.args.map((arg) => numeric(evaluate(arg, scope)))
      if (args.some((arg) => arg === undefined)) {
        return undefined
      }
      return callFunction(
        expr.name,
        args.filter((arg): arg is number => arg !== undefined)
      )
    }
  }
}
