import { readFileSync, readdirSync, readlinkSync } from "node:fs"
import { expect, type Frame, type Page } from "@playwright/test"
import { axeViolations } from "../support/axe.ts"
import { runCommand } from "./commands.ts"
import { test } from "./fixtures.ts"
import { cancelForm, invokeForm } from "./invoke.ts"

const readOr = (file: string): string => {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return ""
  }
}

const listOr = (directory: string): ReadonlyArray<string> => {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}

const linkOr = (file: string): string => {
  try {
    return readlinkSync(file)
  } catch {
    return ""
  }
}

const parentOf = (pid: string): string => readOr(`/proc/${pid}/stat`).split(") ")[1]?.split(" ")[1] ?? ""

const descendants = (root: string): ReadonlyArray<string> => {
  const processes = listOr("/proc").filter((entry) => /^\d+$/.test(entry))
  const found = [root]
  for (let index = 0; index < found.length; index += 1) {
    found.push(...processes.filter((pid) => parentOf(pid) === found[index]))
  }
  return found.slice(1)
}

const listeningInodes = (): ReadonlySet<string> =>
  new Set(
    ["/proc/net/tcp", "/proc/net/tcp6"]
      .flatMap((table) => readOr(table).split("\n").slice(1))
      .map((line) => line.trim().split(/\s+/))
      .filter((columns) => columns[3] === "0A")
      .map((columns) => columns[9] ?? "")
  )

const listeningChildren = (root: string): ReadonlyArray<string> => {
  const inodes = listeningInodes()
  return descendants(root).flatMap((pid) =>
    listOr(`/proc/${pid}/fd`)
      .map((fd) => /^socket:\[(\d+)\]$/.exec(linkOr(`/proc/${pid}/fd/${fd}`))?.[1])
      .filter((inode) => inode !== undefined && inodes.has(inode))
      .map(() => `${pid} ${readOr(`/proc/${pid}/cmdline`).replaceAll("\0", " ").slice(0, 200)}`)
  )
}

const workbenchColors = (window: Page) =>
  window.evaluate(() => {
    const probe = document.createElement("div")
    probe.style.backgroundColor = "var(--vscode-sideBar-background)"
    probe.style.color = "var(--vscode-foreground)"
    document.querySelector(".monaco-workbench")?.append(probe)
    const style = getComputedStyle(probe)
    const colors = { background: style.backgroundColor, text: style.color }
    probe.remove()
    return colors
  })

const formColors = (frame: Frame) =>
  frame.locator("form.card").evaluate((card) => {
    const style = getComputedStyle(card)
    return { background: style.backgroundColor, text: style.color }
  })

const themes = { light: "vs", dark: "vs-dark", "high contrast": "hc-black" } as const

type Theme = keyof typeof themes

const useTheme = async (window: Page, frame: Frame, theme: Theme): Promise<string> => {
  await runCommand(window, `Ask Form: Use the ${theme} theme for acceptance`)
  await expect(window.locator(".monaco-workbench")).toHaveClass(new RegExp(`(^|\\s)${themes[theme]}(\\s|$)`))
  const expected = await workbenchColors(window)
  await expect.poll(() => formColors(frame)).toEqual(expected)
  return expected.background
}

const themeNames = Object.keys(themes) as ReadonlyArray<Theme>

test.afterEach(async ({ session }, testInfo) => {
  await cancelForm(session, testInfo)
  await runCommand(session.window, "Ask Form: Use the dark theme for acceptance")
})

test("REQ-LOOK-001 フォームは、VS Codeのテーマを切り替えると、そのテーマの色で表示される", async ({ session }) => {
  const { frame } = await invokeForm(session, "Ask Form: Show every question type")
  const seen = new Set<string>()
  for (const theme of themeNames) {
    seen.add(await useTheme(session.window, frame, theme))
  }
  expect(seen.size).toBe(themeNames.length)
})

test("REQ-A11Y-001 どのテーマでもフォームにaxeの違反がなく、推奨の理由が読み上げの説明になる", async ({ session }) => {
  const { frame } = await invokeForm(session, "Ask Form: Show every question type")
  await expect(frame.getByRole("form", { name: /^質問の型/ })).toBeVisible()
  await expect(frame.getByRole("radio", { name: /ブラウザ/ })).toHaveAccessibleDescription(/まずは自分用のため/)
  for (const theme of themeNames) {
    await useTheme(session.window, frame, theme)
    expect(await axeViolations(frame), theme).toEqual([])
  }
})

test("REQ-SEC-001 フォームが回答を待つ間も、VS Codeが起動した拡張機能ホストなどのプロセスはどのポートも待ち受けない", async ({
  session
}) => {
  test.skip(process.platform !== "linux", "/procでポートを調べる")
  const root = String(session.pid)
  const { frame } = await invokeForm(session)
  await expect(frame.locator("form.card")).toBeVisible()
  expect(descendants(root).length).toBeGreaterThan(0)
  expect(listeningChildren(root)).toEqual([])
})
