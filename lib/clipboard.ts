// Clipboard write with graceful fallback.
//
// The modern async Clipboard API (`navigator.clipboard.writeText`) requires:
//   - a secure context (HTTPS, or localhost)
//   - a user gesture (the click event driving this call satisfies it)
//   - clipboard-write permission granted (most browsers auto-grant on gesture)
//
// In local HTTP dev (`http://0.0.0.0:3000` on another machine, a preview
// proxy, etc.) the modern API is unavailable — `navigator.clipboard` is
// `undefined`. In sandboxed iframes or older browsers the API may also
// be blocked.
//
// This helper tries the modern path first and falls back to the legacy
// `document.execCommand('copy')` via a temporary hidden textarea. The
// legacy path is deprecated but still widely supported and covers the
// dev-over-HTTP and ancient-browser cases. Returns a boolean so the
// caller can surface a visible "copy failed" state on genuine failure.

export async function copyToClipboard(text: string): Promise<boolean> {
  // Server-side rendering defense — neither API exists.
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false
  }

  // Modern API path.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Secure-context violation, permission denied, or other error —
      // fall through to the legacy path rather than giving up.
    }
  }

  // Legacy fallback: create a temporary textarea, select it, copy.
  const ta = document.createElement("textarea")
  ta.value = text
  // Position fixed + near-zero opacity keeps the element off-screen
  // without triggering a scroll jump when focused.
  ta.style.position = "fixed"
  ta.style.top = "0"
  ta.style.left = "0"
  ta.style.width = "1px"
  ta.style.height = "1px"
  ta.style.opacity = "0"
  ta.style.pointerEvents = "none"
  ta.setAttribute("readonly", "")
  ta.setAttribute("aria-hidden", "true")
  document.body.appendChild(ta)

  let ok = false
  try {
    ta.select()
    ta.setSelectionRange(0, text.length)
    // execCommand is deprecated but still the standard fallback for
    // clipboard writes outside secure contexts.
    ok = document.execCommand("copy")
  } catch {
    ok = false
  } finally {
    document.body.removeChild(ta)
  }
  return ok
}
