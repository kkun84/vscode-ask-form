import { vi } from "vitest"

export const withVscode = async <A>(vscode: unknown, load: () => Promise<A>): Promise<A> => {
  vi.doMock("vscode", () => vscode as Record<string, unknown>)
  try {
    return await load()
  } finally {
    vi.doUnmock("vscode")
  }
}
