/**
 * Plain-text reference scan — the pure decision core behind the takeover
 * editor's chip decorations (T9; composer-revival plan §3 technical fact 2:
 * the draft text is the line format, chips are decorations over it, so a
 * token edited out of match shape simply drops its chip on the next scan and
 * the text round-trip through the host's setDraft/restoreDraft stays
 * lossless by construction).
 *
 * The token grammar itself (wire session form, `@` shape tokens, the
 * `/skill` gesture, punctuation shedding, overlap resolution) lives once in
 * `ref-grammar.ts`, shared with the sent-text projection. This module is the
 * draft-editor refinement: no session labels (the editor has no recall
 * context), and every `at` token resolves to a file/folder kind by the
 * trailing slash of its shed path — exactly the host ReferenceChip kinds.
 */
import { atTokenPath, scanRefTokens } from './ref-grammar.ts'

/** The chip kinds the composer decorates, mirroring the host ReferenceChip kinds. */
export type RefChipKind = 'file' | 'folder' | 'session' | 'skill'

/** One matched reference range in draft coordinates. */
export interface RefChipRange {
  readonly start: number
  readonly end: number
  readonly kind: RefChipKind
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
  return scanRefTokens(text, { skills }).map((token) => {
    if (token.kind === 'session' || token.kind === 'skill') {
      return { start: token.start, end: token.end, kind: token.kind }
    }
    return {
      start: token.start,
      end: token.end,
      kind: atTokenPath(token.label).endsWith('/') ? 'folder' : 'file',
    }
  })
}
