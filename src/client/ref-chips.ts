/**
 * Plain-text reference scan — the pure decision core behind the takeover
 * editor's chip decorations (T9; composer-revival plan §3 technical fact 2:
 * the draft text is the line format, chips are decorations over it, so a
 * token edited out of match shape simply drops its chip on the next scan and
 * the text round-trip through the host's setDraft/restoreDraft stays
 * lossless by construction).
 *
 * Grammar mirrors the host's two presentations:
 * - the composer's text-ref scan (`ui-conversation/input/decorations.ts`):
 *   a `/name` token sits at a whitespace boundary, ends at whitespace or the
 *   draft end (the skill-gesture discipline — `/name/x` is a path, `/name。`
 *   is prose), and hits the hot skill dictionary exactly (case-sensitive);
 * - the sent-text projection (`ui-primitives/user-text.tsx`): the wire
 *   session form `@[label](dsh-session:…)` and shape-recognized `@` tokens —
 *   `@"path with spaces"` quoted or any non-space run, trailing sentence
 *   punctuation stripped, a trailing slash marking a folder.
 *
 * Markdown syntax is deliberately not consulted (the host's projection is
 * text-shape-only too): what the draft chips is what the sent bubble chips.
 */

/** The chip kinds the composer decorates, mirroring the host ReferenceChip kinds. */
export type RefChipKind = 'file' | 'folder' | 'session' | 'skill'

/** One matched reference range in draft coordinates. */
export interface RefChipRange {
  readonly start: number
  readonly end: number
  readonly kind: RefChipKind
}

/** The wire form a session chip serializes to (`user-text.tsx` parity). */
const SESSION_WIRE_RE = /@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/gu

/** Shape-recognized `@` tokens: the quoted whitespace form or a bare run. */
const AT_SHAPE_RE = /(^|\s)(@"[^"\n]+"|@[^\s]+)/gu

/** The `/skill` token: trigger at a whitespace boundary, word-ish name. */
const SKILL_TOKEN_RE = /(^|\s)\/([\w-]+)/gu

/** Sentence punctuation a bare `@` token sheds (the wire/bubble discipline). */
const TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？]+$/u

/**
 * What may follow a `/name` token: whitespace or the draft end — the host
 * skill gesture (`dsh-tool-skill`) boundary, so paths and prose never chip.
 */
const SKILL_TOKEN_END_RE = /^(?:\s|$)/

/** Overlap resolution rank: the wire form outranks everything at its span. */
function rankOf(kind: RefChipKind): number {
  return kind === 'session' ? 0 : kind === 'skill' ? 1 : 2
}

/**
 * Scan the draft for reference chips. Pure over (text, skills): decorations
 * recompute from the edited text, and a missing/empty dictionary degrades the
 * `/` arm to plain text (the per-face probe's contract) while the shape-only
 * `@` arms stay available — they need no host data plane.
 * @param text - the draft text (the line format).
 * @param skills - the hot skill dictionary for the `/` trigger.
 * @returns matched ranges in draft order, non-overlapping.
 */
export function scanRefChips(text: string, skills: ReadonlySet<string>): RefChipRange[] {
  if (text === '') return []
  const out: RefChipRange[] = []

  SESSION_WIRE_RE.lastIndex = 0
  let wire: RegExpExecArray | null
  while ((wire = SESSION_WIRE_RE.exec(text)) !== null) {
    out.push({ start: wire.index, end: wire.index + wire[0].length, kind: 'session' })
  }

  AT_SHAPE_RE.lastIndex = 0
  let at: RegExpExecArray | null
  while ((at = AT_SHAPE_RE.exec(text)) !== null) {
    const raw = at[2] ?? ''
    const start = at.index + (at[1]?.length ?? 0)
    // Only bare tokens shed sentence punctuation; a quote closes the token.
    const label = raw.startsWith('@"') ? raw : raw.replace(TRAILING_PUNCTUATION_RE, '')
    if (label.length <= 1) continue
    const path = label.slice(1).replace(/^"|"$/gu, '')
    out.push({ start, end: start + label.length, kind: path.endsWith('/') ? 'folder' : 'file' })
  }

  if (skills.size > 0) {
    SKILL_TOKEN_RE.lastIndex = 0
    let skill: RegExpExecArray | null
    while ((skill = SKILL_TOKEN_RE.exec(text)) !== null) {
      const name = skill[2] ?? ''
      if (!SKILL_TOKEN_END_RE.test(text.slice(skill.index + skill[0].length))) continue
      if (!skills.has(name)) continue
      const start = skill.index + (skill[1]?.length ?? 0)
      out.push({ start, end: start + 1 + name.length, kind: 'skill' })
    }
  }

  out.sort((a, b) => a.start - b.start || rankOf(a.kind) - rankOf(b.kind) || b.end - a.end)
  const kept: RefChipRange[] = []
  let cursor = 0
  for (const range of out) {
    if (range.start < cursor) continue
    kept.push(range)
    cursor = range.end
  }
  return kept
}
