import * as vscode from "vscode"

type Body = () => Promise<void>

const tests: Array<{ readonly name: string; readonly body: Body }> = []

export const test = (name: string, body: Body): void => {
  tests.push({ name, body })
}

export const check = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message)
  }
}

export const eventually = async (condition: () => boolean, message: string, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out: ${message}`)
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
  }
}

export const extension = (): vscode.Extension<unknown> => {
  const found = vscode.extensions.getExtension("kkun84.ask-form")
  if (found === undefined) {
    throw new Error("extension kkun84.ask-form is not installed")
  }
  return found
}

export const run = async (): Promise<void> => {
  const failed: Array<string> = []
  for (const { name, body } of tests) {
    console.log(`start ${name}`)
    try {
      await body()
      console.log(`ok ${name}`)
    } catch (error) {
      failed.push(name)
      console.error(`not ok ${name}`, error)
    }
  }
  if (failed.length > 0) {
    throw new Error(`${failed.length} acceptance test(s) failed: ${failed.join(", ")}`)
  }
}
