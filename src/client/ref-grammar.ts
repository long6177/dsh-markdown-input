/**
 * The one reference-token grammar shared by the two consumers that encode it
 * (审查修复 #71 — it used to live twice, in `ref-chips.ts` and
 * `user-text-projection.tsx`, and had already micro-diverged):
 *
 * - the wire session form `@[label](dsh-session:…)` folds to its label
 *   (`user-text.tsx` parity);
 * - exact session mention labels supplied by an adjacent recall decorate
 *   their bare `@label` occurrences (sent-bubble only — the draft editor has
 *   no recall context and never passes `sessionLabels`);
 * - shape-recognized tokens at a whitespace boundary: the quoted whitespace
 *   form `@"…"`, any bare `@` non-space run (trailing sentence punctuation
 *   shed), and the `/name` skill gesture — word-ish name, whitespace- or
 *   end-bounded like the host `dsh-tool-skill` discipline, kept plain unless
 *   the caller's skill dictionary names it.
 *
 * Markdown syntax is deliberately not consulted (the host's projections are
 * text-shape-only too): what the draft chips is what the sent bubble chips.
 *
 * The scan is pure over (text, options): ranges recompute from the text, and
 * a missing/empty skill dictionary degrades the `/` arm to plain text (the
 * per-face probe's contract) while the shape-only `@` arms stay available.
 *
 * Overlap resolution: ranges sort by (start, kind rank, longer-first) and a
 * left-to-right cursor keeps the first range over any overlapping one. The
 * rank orders `session` over `skill` over `at` — only `session` can ever
 * contend (wire/label and shape tokens share the same `@`-anchored span);
 * a `skill` range and an `at`/`session` range can never overlap or share a
 * start, because their trigger characters `/` and `@` both require a
 * whitespace-or-start boundary. (The sent-bubble projection historically
 * ranked all non-session tokens flat; since only session ever contended
 * there, this finer order is observably identical for both consumers.)
 *
 * Kind refinement is the consumer's business (see the two modules): the
 * draft editor turns `at` into file/folder; the projection additionally
 * picks icons and display labels. One preserved pre-existing edge: for a
 * bare token ending in a quote after the path (e.g. `@a/b"`), the draft
 * editor's folder test strips boundary quotes from the shed path
 * (`a/b` → folder) while the projection's appearance test strips only
 * `^@"`/`"$` from the whole label (`@a/b` → file) — each consumer keeps its
 * own verbatim refinement, so the edge stays as shipped.
 */

/** The token kinds the shared scan distinguishes before consumer refinement. */
export type RefTokenKind = 'session' | 'skill' | 'at'

/** One matched reference token range in text coordinates. */
export interface RefTokenRange {
  readonly start: number
  readonly end: number
  readonly kind: RefTokenKind
  /** Matched token text after sentence-punctuation shedding (hover title). */
  readonly label: string
  /** Wire session form only: the display label captured inside `@[label](…)`. */
  readonly display?: string
}

/** Options narrowing the shared scan; everything degrades to shape-only. */
export interface RefScanOptions {
  /** Hot skill names the `/name` token decorates; empty keeps every `/` plain. */
  readonly skills?: ReadonlySet<string>
  /** Exact session mention labels (the adjacent-recall input); draft scans pass none. */
  readonly sessionLabels?: readonly string[]
}

/** The wire form a session chip serializes to; label is the display text. */
const SESSION_WIRE_RE = /@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/gu

/**
 * Shape-recognized tokens at a whitespace boundary, in alternation order:
 * the `/skill` gesture (whitespace/end tail), the quoted whitespace form,
 * the bare `@` run.
 */
const TOKEN_RE = /(^|\s)(\/[\w-]+(?=\s|$)|@"[^"\n]+"|@[^\s]+)/gu

/** Sentence punctuation a bare token sheds (the wire/bubble discipline). */
const TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？]+$/u

/** Overlap-resolution rank: the wire/label session form outranks its span. */
function rankOf(kind: RefTokenKind): number {
  return kind === 'session' ? 0 : kind === 'skill' ? 1 : 2
}

/**
 * The path text an `@` token carries: the `@` and the boundary quotes of the
 * quoted form shed. The draft editor folder-tests this path's trailing
 * slash; the projection splits it for the display basename.
 */
export function atTokenPath(label: string): string {
  return label.slice(1).replace(/^"|"$/gu, '')
}

/**
 * Scan text for reference tokens.
 * @param text - the draft or sent text (the line format).
 * @param options - the skill dictionary and the exact session labels.
 * @returns matched ranges in text order, non-overlapping.
 */
export function scanRefTokens(text: string, options: RefScanOptions = {}): RefTokenRange[] {
  if (text === '') return []
  const ranges: RefTokenRange[] = []

  SESSION_WIRE_RE.lastIndex = 0
  let wire: RegExpExecArray | null
  while ((wire = SESSION_WIRE_RE.exec(text)) !== null) {
    ranges.push({
      start: wire.index,
      end: wire.index + wire[0].length,
      kind: 'session',
      label: wire[0],
      display: wire[1] as string, // non-optional capture in SESSION_WIRE_RE
    })
  }

  for (const rawLabel of [...new Set(options.sessionLabels ?? [])].sort((a, b) => b.length - a.length)) {
    const label = `@${rawLabel}`
    let start = text.indexOf(label)
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, kind: 'session', label })
      start = text.indexOf(label, start + label.length)
    }
  }

  TOKEN_RE.lastIndex = 0
  let token: RegExpExecArray | null
  while ((token = TOKEN_RE.exec(text)) !== null) {
    const start = token.index + (token[1]?.length ?? 0) // (^|\s) captures '' at line start
    const raw = token[2] ?? '' // non-optional alternation capture
    // Only bare tokens shed sentence punctuation; a quote closes the token.
    const label = raw.startsWith('@"') ? raw : raw.replace(TRAILING_PUNCTUATION_RE, '')
    if (label.length <= 1) continue
    if (label.startsWith('/') && !(options.skills?.has(label.slice(1)) ?? false)) continue
    ranges.push({ start, end: start + label.length, kind: label.startsWith('/') ? 'skill' : 'at', label })
  }

  ranges.sort((a, b) => a.start - b.start || rankOf(a.kind) - rankOf(b.kind) || b.end - a.end)
  const kept: RefTokenRange[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) continue
    kept.push(range)
    cursor = range.end
  }
  return kept
}
