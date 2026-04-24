/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { copyToClipboard } from "@/lib/clipboard"

// jsdom doesn't implement document.execCommand at all (the real browser
// one is deprecated; jsdom just omits it). Tests that exercise the
// fallback path install their own exec stub directly on the document
// object and restore it afterward.
function installExec(fn: (cmd: string) => boolean) {
  ;(document as unknown as { execCommand: (cmd: string) => boolean }).execCommand = fn
}
function uninstallExec() {
  delete (document as unknown as { execCommand?: unknown }).execCommand
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
    writable: true,
  })
}

describe("copyToClipboard", () => {
  let originalClipboard: typeof navigator.clipboard | undefined

  beforeEach(() => {
    originalClipboard = navigator.clipboard
  })

  afterEach(() => {
    if (originalClipboard !== undefined) {
      setClipboard(originalClipboard)
    }
    uninstallExec()
  })

  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    setClipboard({ writeText })

    const ok = await copyToClipboard("hello")

    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith("hello")
  })

  it("falls back to execCommand when navigator.clipboard is absent", async () => {
    setClipboard(undefined)
    const calls: string[] = []
    installExec((cmd: string) => {
      calls.push(cmd)
      return cmd === "copy"
    })

    const ok = await copyToClipboard("text-for-fallback")

    expect(ok).toBe(true)
    expect(calls).toEqual(["copy"])
  })

  it("falls back to execCommand when async clipboard throws", async () => {
    setClipboard({ writeText: vi.fn(() => Promise.reject(new Error("permission denied"))) })
    let called = false
    installExec((cmd: string) => {
      called = true
      return cmd === "copy"
    })

    const ok = await copyToClipboard("permission-test")

    expect(ok).toBe(true)
    expect(called).toBe(true)
  })

  it("returns false when both paths fail", async () => {
    setClipboard(undefined)
    installExec(() => false)

    const ok = await copyToClipboard("nope")

    expect(ok).toBe(false)
  })

  it("cleans up the temporary textarea in the fallback path", async () => {
    setClipboard(undefined)
    installExec((cmd: string) => cmd === "copy")

    const beforeCount = document.querySelectorAll("textarea").length
    await copyToClipboard("cleanup-check")
    const afterCount = document.querySelectorAll("textarea").length

    expect(afterCount).toBe(beforeCount) // temporary textarea removed
  })

  it("removes textarea even when execCommand throws", async () => {
    setClipboard(undefined)
    installExec(() => {
      throw new Error("copy blocked")
    })

    const beforeCount = document.querySelectorAll("textarea").length
    const ok = await copyToClipboard("throwy")

    expect(ok).toBe(false)
    expect(document.querySelectorAll("textarea").length).toBe(beforeCount)
  })
})
