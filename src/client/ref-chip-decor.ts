/**
 * The takeover editor's chip decorations (T9): the CM6 equivalent of the
 * host's text-ref decoration — marks styled like the host ReferenceChip
 * over the plain draft, computed by the `scanRefChips` decision core
 * (composer-revival plan §3 technical fact 2). The document text is never
 * touched: chips appear and disappear with the scan, so host
 * setDraft/restoreDraft round-trips stay lossless by construction.
 *
 * Two external inputs ride StateEffects because they change without a doc
 * edit, exactly like the host's lexicon re-scan and claim nudge:
 * - the hot skill dictionary (the `remote.skills` face resolves after
 *   mount; an empty roll keeps `/` tokens plain — the per-face degradation);
 * - the active command claim (token mark + the trailing ghost hint, the
 *   native claim decoration's copy keys).
 *
 * A decoration build failure degrades to plain text (never breaks the text
 * face); the ghost hint hides during IME composition through a
 * `data-mdx-composing` attribute, the host's own CSS gate.
 */
import { RangeSet, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { scanRefChips } from './ref-chips.ts'

/** The active claim as the editor sees it: token text plus resolved hint copy. */
export interface ClaimGhost {
  /** The claim token exactly as inserted (trailing separator included). */
  readonly token: string
  /** Resolved display hint (the translated native key or the machine's own). */
  readonly hint: string
}

/** External lexicon update: the session's hot skill names for the `/` trigger. */
export const setSkillLexiconEffect = StateEffect.define<readonly string[]>()

/** External claim update: the resolved ghost, or null while unclaimed. */
export const setClaimGhostEffect = StateEffect.define<ClaimGhost | null>()

/** The ghost hint widget: inert inline text after the claimed token. */
class ClaimHintWidget extends WidgetType {
  constructor(readonly hint: string) { super() }

  override eq(other: ClaimHintWidget): boolean {
    return other.hint === this.hint
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-mdx-claim-hint'
    span.textContent = this.hint
    span.setAttribute('aria-hidden', 'true')
    span.contentEditable = 'false'
    return span
  }

  override ignoreEvent(): boolean {
    return true
  }
}

/**
 * Build the decoration set for the whole document. Marks only — the text
 * stays plain (the one paste-decision note holds here too: a scan-derived
 * mark set can never wedge on edit bounds).
 */
function buildChipDecorations(state: EditorState, skills: readonly string[], claim: ClaimGhost | null): DecorationSet {
  const text = state.doc.toString()
  const ranges: Range<Decoration>[] = []
  // The claim seat owns the leading token (host claim-decor precedence): a
  // ref equal to the active claim token stays a plain claim mark.
  const trimmedClaim = claim?.token.trimEnd() ?? null
  for (const chip of scanRefChips(text, new Set(skills))) {
    if (trimmedClaim !== null && chip.start === 0 && text.slice(chip.start, chip.end) === trimmedClaim) continue
    ranges.push(Decoration.mark({ class: `cm-mdx-ref cm-mdx-ref-${chip.kind}` }).range(chip.start, chip.end))
  }
  if (claim !== null && text.startsWith(claim.token)) {
    const tokenEnd = claim.token.trimEnd().length
    if (tokenEnd > 0) ranges.push(Decoration.mark({ class: 'cm-mdx-claim-token' }).range(0, tokenEnd))
    // The ghost hint shows while the claim's args are blank (a hint implies
    // a single-line token draft — the native InputBar contract).
    if (text.slice(claim.token.length).trim() === '') {
      ranges.push(Decoration.widget({ widget: new ClaimHintWidget(claim.hint), side: 1 }).range(text.length))
    }
  }
  return RangeSet.of(ranges, true)
}

/** Same, but a build failure degrades to plain text instead of breaking the face. */
let buildFailureLogged = false
function safeBuild(state: EditorState, skills: readonly string[], claim: ClaimGhost | null): DecorationSet {
  try {
    return buildChipDecorations(state, skills, claim)
  } catch (error: unknown) {
    // One report per page life: a persistent failure must not log per keystroke.
    if (!buildFailureLogged) {
      buildFailureLogged = true
      console.error('[markdown-input] ref-chip decoration build failed; degrading to plain text', error)
    }
    return Decoration.none
  }
}

interface ChipState {
  readonly skills: readonly string[]
  readonly claim: ClaimGhost | null
  readonly decorations: DecorationSet
}

const chipField = StateField.define<ChipState>({
  create: () => ({ skills: [], claim: null, decorations: Decoration.none }),
  update(value, tr) {
    let { skills, claim } = value
    let external = false
    for (const effect of tr.effects) {
      if (effect.is(setSkillLexiconEffect)) { skills = effect.value; external = true }
      if (effect.is(setClaimGhostEffect)) { claim = effect.value; external = true }
    }
    // Every doc edit re-scans (the host marks all text nodes dirty on the
    // same event); draft documents are small, the scan is linear.
    if (!external && !tr.docChanged) return value
    return { skills, claim, decorations: safeBuild(tr.state, skills, claim) }
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})

/** Composition marker: the CSS hook the ghost hint hides under (host parity). */
const compositionMarker = EditorView.domEventHandlers({
  compositionstart: (_event, view) => {
    view.dom.setAttribute('data-mdx-composing', '')
    return false
  },
  compositionend: (_event, view) => {
    view.dom.removeAttribute('data-mdx-composing')
    return false
  },
})

/** Chip + claim decorations; mounted unconditionally on the editor surface. */
export const refChipDecorations: Extension = [chipField, compositionMarker]
