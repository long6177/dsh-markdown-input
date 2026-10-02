/**
 * L1 paint layer's syntax range parser (issue #15, ADR-0003): raw draft
 * text in, inline-mark ranges out. Pure string work — no DOM, no host
 * types — so the paint engine can map the ranges onto the live editor's
 * text nodes while this half stays unit-testable on offsets alone.
 *
 * Scope: the inline four (bold, italic, inline code, strikethrough),
 * parsed per line — the composer renders each paragraph as its own block,
 * so markers must never pair across one. Precedence is code spans first
 * (fully opaque to the other syntax), then strike, then bold, then italic;
 * emphasis markers consumed by a longer form are not re-claimed by a
 * shorter one, while content stays scannable so `*a **b** c*` keeps both.
 * Flanking rules follow CommonMark where it is cheap: asterisks pair
 * intra-word, underscores do not; escaped `* _ ` ~` are literal.
 */

/** One of the four inline styles the paint layer renders. */
export type InlineMarkType = 'bold' | 'italic' | 'code' | 'strike'

/** A half-open `[start, end)` character range in the source text. */
export interface TextRange {
  readonly start: number
  readonly end: number
}

/** One inline syntax segment: two dimmed markers around colored content. */
export interface InlineMark {
  readonly type: InlineMarkType
  /** The two syntax-marker ranges, in source order. */
  readonly markers: readonly [TextRange, TextRange]
  readonly content: TextRange
}

/** Backslash-escapable characters that double as inline syntax markers. */
const ESCAPABLE = new Set(['*', '_', '`', '~', '\\'])

interface Line {
  readonly text: string
  readonly offset: number
}

function isWhitespace(char: string): boolean {
  return char !== '' && /\s/u.test(char)
}

function isWordChar(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char)
}

function matchesAt(text: string, index: number, marker: string): boolean {
  return text.startsWith(marker, index)
}

/** Split into non-empty lines with their absolute source offsets. */
function splitLines(source: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (;;) {
    const newline = source.indexOf('\n', start)
    const end = newline === -1 ? source.length : newline
    if (end > start) lines.push({ text: source.slice(start, end), offset: start })
    if (newline === -1) break
    start = newline + 1
  }
  return lines
}

/**
 * Mark characters that a preceding backslash escapes (`\*` is a literal
 * star). An escaped character cannot itself start another escape, so the
 * scan steps over each escape pair.
 */
function escapeMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false)
  let index = 0
  while (index < text.length) {
    if (text.charAt(index) === '\\' && ESCAPABLE.has(text.charAt(index + 1))) {
      mask[index + 1] = true
      index += 2
    } else {
      index += 1
    }
  }
  return mask
}

/**
 * Scan one line for code spans and consume them fully — backtick runs pair
 * with the next run of the same length (CommonMark), and everything between
 * the two runs is opaque: no other pass may range inside a code span.
 */
function scanCodeSpans(
  text: string,
  offset: number,
  escaped: readonly boolean[],
  consumed: boolean[],
  out: InlineMark[],
): void {
  const runs: { start: number, length: number }[] = []
  let index = 0
  while (index < text.length) {
    if (text.charAt(index) === '`' && !escaped[index]) {
      let end = index
      while (end < text.length && text.charAt(end) === '`' && !escaped[end]) end += 1
      runs.push({ start: index, length: end - index })
      index = end
    } else {
      index += 1
    }
  }
  let opener = 0
  while (opener < runs.length) {
    const open = runs[opener]!
    let closer = opener + 1
    while (closer < runs.length && runs[closer]!.length !== open.length) closer += 1
    if (closer === runs.length) {
      opener += 1
      continue
    }
    const close = runs[closer]!
    const contentStart = open.start + open.length
    const contentEnd = close.start
    if (contentEnd > contentStart && text.slice(contentStart, contentEnd).trim() !== '') {
      out.push({
        type: 'code',
        markers: [
          { start: offset + open.start, end: offset + open.start + open.length },
          { start: offset + close.start, end: offset + close.start + close.length },
        ],
        content: { start: offset + contentStart, end: offset + contentEnd },
      })
      for (let p = open.start; p < close.start + close.length; p += 1) consumed[p] = true
      opener = closer + 1
    } else {
      // Empty interior: this run cannot open a span; try the next as opener.
      opener += 1
    }
  }
}

/** Whether a marker may open a span at `index` (CommonMark flanking, cheap). */
function opens(text: string, index: number, marker: string): boolean {
  const size = marker.length
  const next = text.charAt(index + size)
  if (marker === '*') {
    return next !== '' && !isWhitespace(next) && next !== '*'
  }
  if (marker === '_') {
    return next !== '' && !isWhitespace(next) && next !== '_'
      && !isWordChar(text.charAt(index - 1))
  }
  if (marker === '__') {
    return !isWhitespace(next) && !isWordChar(text.charAt(index - 1))
  }
  return !isWhitespace(next)
}

/** Whether a marker may close a span at `index`. */
function closes(text: string, index: number, marker: string): boolean {
  const size = marker.length
  const prev = text.charAt(index - 1)
  if (marker === '*') {
    return prev !== '' && !isWhitespace(prev) && prev !== '*'
  }
  if (marker === '_') {
    const after = text.charAt(index + size)
    return prev !== '' && !isWhitespace(prev) && after !== '_' && !isWordChar(after)
  }
  if (marker === '__') {
    return !isWhitespace(prev) && !isWordChar(text.charAt(index + size))
  }
  return !isWhitespace(prev)
}

/**
 * Scan one line for one delimited form (`~~`, `**`, `__`, `*`, `_`). Only
 * marker characters are consumed — content stays scannable so a shorter
 * form can still pair inside a longer one's content. A run of `size`
 * characters is only a marker when none of its characters are escaped or
 * already consumed by an earlier pass.
 */
function scanDelimited(
  text: string,
  offset: number,
  escaped: readonly boolean[],
  consumed: boolean[],
  marker: string,
  type: InlineMarkType,
  out: InlineMark[],
): void {
  const size = marker.length
  const free = (index: number): boolean => {
    for (let k = 0; k < size; k += 1) {
      if (escaped[index + k] || consumed[index + k]) return false
    }
    return true
  }
  let index = 0
  while (index + 2 * size <= text.length) {
    let end = -1
    if (matchesAt(text, index, marker) && free(index) && opens(text, index, marker)) {
      let probe = index + size
      while (probe + size <= text.length) {
        // An immediately adjacent twin would leave empty content — not a span.
        if (probe > index + size
          && matchesAt(text, probe, marker) && free(probe) && closes(text, probe, marker)) {
          end = probe
          break
        }
        probe += 1
      }
    }
    if (end === -1) {
      index += 1
      continue
    }
    out.push({
      type,
      markers: [
        { start: offset + index, end: offset + index + size },
        { start: offset + end, end: offset + end + size },
      ],
      content: { start: offset + index + size, end: offset + end },
    })
    for (let k = 0; k < size; k += 1) {
      consumed[index + k] = true
      consumed[end + k] = true
    }
    index = end + size
  }
}

/**
 * Parse the inline four out of raw draft text. Offsets are absolute in
 * `source`; matches never cross a newline and never sit inside a code
 * span. Unclosed, empty, or escaped forms stay literal (unranged). Nested
 * emphasis is approximated flat: a shorter form may pair inside a longer
 * one's content, while `***…***`-style triple markers degrade to the
 * longest form only.
 * @param source - the raw draft text.
 */
export function parseInlineMarks(source: string): InlineMark[] {
  const marks: InlineMark[] = []
  for (const line of splitLines(source)) {
    if (line.text.length === 0) continue
    const escaped = escapeMask(line.text)
    const consumed = new Array<boolean>(line.text.length).fill(false)
    scanCodeSpans(line.text, line.offset, escaped, consumed, marks)
    scanDelimited(line.text, line.offset, escaped, consumed, '~~', 'strike', marks)
    scanDelimited(line.text, line.offset, escaped, consumed, '**', 'bold', marks)
    scanDelimited(line.text, line.offset, escaped, consumed, '__', 'bold', marks)
    scanDelimited(line.text, line.offset, escaped, consumed, '*', 'italic', marks)
    scanDelimited(line.text, line.offset, escaped, consumed, '_', 'italic', marks)
  }
  return marks
}
