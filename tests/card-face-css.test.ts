/**
 * Seam: the takeover card face's paint — the background chain that keeps the
 * face opaque. Pinned as sheet text (the issue #39 pattern): jsdom has no
 * layout and the sheet is the shipped artifact, so these are regression nails
 * on what the rules say, not behavior tests. alpha.12's real-machine window
 * drag showed the placeholder row see-through because the face's only base
 * was a `transparent` fallback on `--dsw-bg`, a token the host theme never
 * defined (issue #44).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The sheet text as shipped: read straight off disk (vitest stubs *.module.css).
    CRLF is normalized away — an autocrlf checkout must pin the same text. */
function readSheet(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/gu, '\n')
}

/** The body of one selector's rule, or '' when absent. */
function ruleOf(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return sheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

const composerCss = readSheet('../src/client/MarkdownComposer.module.css')

describe('card face ↔ native input fill CSS contract (issue #44)', () => {
  it('fills the card face with the native input token over an opaque chain', () => {
    const card = ruleOf(composerCss, '.card')
    // The native composer card's own fill token
    // (host ui-conversation InputBar.module.css:62): white in light,
    // rgb(44, 44, 46) in dark — the takeover face now paints the same base.
    expect(card).toContain('background: var(--dsw-specific-input-major')
    // The chain may never land on transparency again: the theme-aware alias
    // (same color pair as the token in both shipped themes) sits in the
    // middle, the terminal fallback is an opaque literal.
    expect(card).toContain('var(--dsw-alias-bg-layer-2, #fff)')
    expect(card).not.toMatch(/background:[^;]*transparent/u)
  })

  it('keeps the drop overlay rounding with the card over the now-opaque face', () => {
    // The overlay covers the card with `inset: 0`; its translucent canvas
    // wash blends over the opaque face now instead of window content, and it
    // must keep the same panel radius so no square corners show inside the
    // card's rounded corners (issue #40's corner parity, not regressed).
    const overlay = ruleOf(composerCss, '.dropOverlay')
    expect(overlay).toContain('inset: 0')
    expect(overlay).toContain('border-radius: var(--dsw-radius-panel')
  })
})
