/**
 * The Markdown a user message's bubble renders: typed line breaks stay
 * visible. GFM folds a single newline inside a paragraph — a list item's
 * lazy continuation line included — into a soft break, which renders as a
 * space; a message the author typed as three lines came out as two (the
 * alpha.17 real-machine feedback). Every line ending outside a fenced code
 * block gets the two trailing spaces that make it a hard break, so the
 * bubble shows the lines as written. Fence interiors stay untouched (a
 * break cannot exist in code, and the spaces would ride along on copy),
 * blank lines stay blank (they already separate blocks), and a line that
 * already ends in a hard break is left as it is.
 */

/** Opening fence: up to three spaces, then three or more backticks/tildes. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

/** Closing fence: the same with nothing but whitespace after it. */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/

/**
 * Turn every soft line break in `text` into a hard one.
 * @param text - the message Markdown about to be rendered.
 * @returns the same text with `  ` appended to each line ending that GFM
 * would otherwise fold into a space (fenced code interiors excluded).
 */
export function hardenSoftBreaks(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let fence: { char: string, length: number } | null = null
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (fence === null) {
      const opening = FENCE_OPEN.exec(line)
      if (opening !== null) {
        fence = { char: opening[1]![0]!, length: opening[1]!.length }
        out.push(line)
        continue
      }
    } else {
      const closing = FENCE_CLOSE.exec(line)
      if (closing !== null && closing[1]![0] === fence.char && closing[1]!.length >= fence.length) {
        fence = null
      }
      out.push(line)
      continue
    }
    // Plain block content: the last line has no ending to harden and a
    // blank line already separates blocks.
    if (index === lines.length - 1 || line.trim() === '') {
      out.push(line)
    } else {
      out.push(line.endsWith('  ') ? line : `${line}  `)
    }
  }
  return out.join('\n')
}
