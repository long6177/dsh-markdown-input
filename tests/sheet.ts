/**
 * Shared test helper: the CSS-contract pins (the issue #44 pattern) read the
 * shipped `*.module.css` sheet text straight off disk — vitest stubs those
 * imports and jsdom has no layout, so the sheet itself is the artifact under
 * contract. CRLF is normalized away: the pins match `\n`-joined multi-line
 * selectors, and an autocrlf checkout must pin the same text, not the
 * platform's line endings.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The sheet text as shipped, CRLF endings normalized to LF. Paths resolve
 * against this `tests/` directory — `'../src/client/X.module.css'` — the
 * same shape every contract test already uses.
 */
export function readSheet(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/gu, '\n')
}

/** The body of one selector's rule, or '' when absent. */
export function ruleOf(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return sheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}
