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

/** An indented code block line: four spaces or a tab, CommonMark's rule. */
const INDENTED_CODE = /^(?: {4}|\t)/

/**
 * A GFM table row, conservatively the pipe-bounded form (leading and trailing
 * `|`): header, delimiter, and body rows all match. Outer-pipe-less tables
 * stay unhandled rather than risk misfiring on ordinary prose (issue #80).
 */
const TABLE_ROW = /^\s*\|.*\|\s*$/

/**
 * Turn every soft line break in `text` into a hard one.
 *
 * Exceptions where a break is not a hard break at all: fenced code interiors,
 * indented code blocks (a blank-line boundary followed by four spaces/tab,
 * per CommonMark — a list item's four-space continuation is NOT one), and
 * pipe-bounded table rows (a trailing space would ride into the last cell).
 * @param text - the message Markdown about to be rendered.
 * @returns the same text with `  ` appended to each line ending that GFM
 * would otherwise fold into a space (the block exceptions excluded).
 */
export function hardenSoftBreaks(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let fence: { char: string, length: number } | null = null
  // Whether the previous line was blank (or the document just started) — the
  // boundary that lets a four-space line open an indented code block.
  let blankBoundary = true
  let indented = false
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
      blankBoundary = line.trim() === ''
      continue
    }
    // Indented code block: every non-blank indented line stays raw; the block
    // ends at the first non-blank line that is not indented.
    if (indented) {
      if (line.trim() === '' || INDENTED_CODE.test(line)) {
        out.push(line)
        blankBoundary = line.trim() === ''
        continue
      }
      indented = false
    }
    if (blankBoundary && INDENTED_CODE.test(line)) {
      indented = true
      out.push(line)
      blankBoundary = false
      continue
    }
    // Table rows carry no hard-break meaning, and a tail space would pollute
    // the last cell; the delimiter row above all must stay exact.
    if (TABLE_ROW.test(line)) {
      out.push(line)
      blankBoundary = false
      continue
    }
    // Plain block content: the last line has no ending to harden and a
    // blank line already separates blocks.
    if (index === lines.length - 1 || line.trim() === '') {
      out.push(line)
    } else {
      out.push(line.endsWith('  ') ? line : `${line}  `)
    }
    blankBoundary = line.trim() === ''
  }
  return out.join('\n')
}
