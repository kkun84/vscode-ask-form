import { registerHooks } from "node:module"

export const withVscode = async <A>(vscode: unknown, load: () => Promise<A>): Promise<A> => {
  const key = Symbol.for("ask-form.test.vscode")
  Object.defineProperty(globalThis, key, { configurable: true, value: vscode })
  const hooks = registerHooks({
    resolve: (specifier, context, next) => (specifier === "vscode" ? { url: "test:vscode", shortCircuit: true } : next(specifier, context)),
    load: (url, context, next) =>
      url === "test:vscode"
        ? {
            format: "module",
            source: Object.keys(vscode as object)
              .map((name) => `export const ${name} = globalThis[Symbol.for("ask-form.test.vscode")][${JSON.stringify(name)}]`)
              .join("\n"),
            shortCircuit: true
          }
        : next(url, context)
  })
  try {
    return await load()
  } finally {
    hooks.deregister()
    Reflect.deleteProperty(globalThis, key)
  }
}
