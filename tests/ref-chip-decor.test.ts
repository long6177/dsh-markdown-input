/**
 * Seam: the CM6 decoration surface of the reference chips (T9) and the
 * claim ghost hint. The tests ride the same `createMarkdownEditor` handle
 * the component mounts, asserting observable DOM effects — chip marks over
 * the plain text, the lexicon arm arriving late (the RPC face resolves
 * after mount), the claim token/hint effects, and the lossless text
 * round-trip the plain-text line format guarantees.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditor, type MarkdownEditorHandle } from '../src/client/markdown-editor.ts'

const mounted: MarkdownEditorHandle[] = []

function mount(): { handle: MarkdownEditorHandle, host: HTMLElement } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const handle = createMarkdownEditor({
    parent: host,
    placeholder: 'ph',
    mode: 'render',
    onSubmit: vi.fn(),
    onDocChange: vi.fn(),
    onFiles: vi.fn(() => true),
  })
  mounted.push(handle)
  return { handle, host }
}

afterEach(() => {
  for (const handle of mounted.splice(0)) handle.destroy()
  document.body.innerHTML = ''
})

/** All chip marks currently rendered, as `kind text` pairs. */
function chips(handle: MarkdownEditorHandle): string[] {
  return [...handle.view.dom.querySelectorAll('.cm-mdx-ref')].map((el) => {
    const kind = [...el.classList].find((c) => c.startsWith('cm-mdx-ref-'))?.slice('cm-mdx-ref-'.length)
    return `${kind ?? '?'} ${el.textContent ?? ''}`
  })
}

describe('ref chip decorations', () => {
  it('decorates @ shapes and skill hits over the plain text', () => {
    const { handle } = mount()
    handle.setSkillLexicon(['plan'])
    handle.setText('use /plan and @a.txt')
    expect(chips(handle)).toEqual(['skill /plan', 'file @a.txt'])
  })

  it('keeps the document text untouched (chips are decorations, the line format survives)', () => {
    const { handle } = mount()
    handle.setSkillLexicon(['plan'])
    const draft = 'see @"path with spaces" + @[Old chat](dsh-session:s-1) and /plan.'
    handle.setText(draft)
    expect(handle.getText()).toBe(draft)
    // `/plan.` is prose (punctuation tail — the skill-gesture discipline):
    // only the quoted file and the session wire form chip here.
    expect(chips(handle)).toEqual(['file @"path with spaces"', 'session @[Old chat](dsh-session:s-1)'])
    // A subsequent edit re-scans; the text is still the same draft.
    handle.view.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(handle.getText()).toBe(`x${draft}`)
  })

  it('an empty lexicon keeps slash tokens plain (dictionary face missing → plain text)', () => {
    const { handle } = mount()
    handle.setText('use /plan now')
    expect(chips(handle)).toEqual([])
    // The lexicon arriving late (RPC face resolution) lights the arm up.
    handle.setSkillLexicon(['plan'])
    expect(chips(handle)).toEqual(['skill /plan'])
    // And a roll change that drops the name drops the chip (host rescan parity).
    handle.setSkillLexicon(['other'])
    expect(chips(handle)).toEqual([])
  })

  it('edits through a chip re-scan without residue', () => {
    const { handle } = mount()
    handle.setSkillLexicon(['plan'])
    handle.setText('use /plan now')
    expect(chips(handle)).toEqual(['skill /plan'])
    // Editing the token out of match shape drops the chip next scan.
    handle.view.dispatch({ changes: { from: 7, to: 8, insert: 'l' } })
    expect(handle.getText()).toBe('use /plln now')
    expect(chips(handle)).toEqual([])
  })

  it('skips the leading range that equals the active claim token (host claim precedence)', () => {
    const { handle } = mount()
    handle.setSkillLexicon(['plan'])
    handle.setText('/plan describe the task')
    handle.setClaimGhost({ token: '/plan ', hint: 'describe your task to generate plan' })
    // The claim seat owns the token: no skill chip under it.
    expect(chips(handle)).toEqual([])
  })
})

describe('claim ghost hint', () => {
  it('shows the trailing hint while the args are blank, and the token mark', () => {
    const { handle } = mount()
    handle.setText('/goal ')
    handle.setClaimGhost({ token: '/goal ', hint: 'describe the objective' })
    expect(handle.view.dom.querySelector('.cm-mdx-claim-token')).not.toBeNull()
    const hint = handle.view.dom.querySelector('.cm-mdx-claim-hint')
    expect(hint?.textContent).toBe('describe the objective')
  })

  it('drops the hint once args are typed, keeps the token mark', () => {
    const { handle } = mount()
    handle.setClaimGhost({ token: '/goal ', hint: 'describe the objective' })
    handle.setText('/goal ship the thing')
    expect(handle.view.dom.querySelector('.cm-mdx-claim-hint')).toBeNull()
    expect(handle.view.dom.querySelector('.cm-mdx-claim-token')).not.toBeNull()
  })

  it('clears both when the claim leaves', () => {
    const { handle } = mount()
    handle.setText('/goal ')
    handle.setClaimGhost({ token: '/goal ', hint: 'describe the objective' })
    handle.setClaimGhost(null)
    expect(handle.view.dom.querySelector('.cm-mdx-claim-token')).toBeNull()
    expect(handle.view.dom.querySelector('.cm-mdx-claim-hint')).toBeNull()
  })

  it('shows nothing when the document does not start with the token', () => {
    const { handle } = mount()
    handle.setClaimGhost({ token: '/goal ', hint: 'describe the objective' })
    handle.setText('oops /goal ')
    expect(handle.view.dom.querySelector('.cm-mdx-claim-token')).toBeNull()
    expect(handle.view.dom.querySelector('.cm-mdx-claim-hint')).toBeNull()
  })

  it('toggles the composing attribute with composition events (the hint hides via CSS)', () => {
    const { handle } = mount()
    const content = handle.view.dom.querySelector('.cm-content') as HTMLElement
    content.dispatchEvent(new CompositionEvent('compositionstart'))
    expect(handle.view.dom.hasAttribute('data-mdx-composing')).toBe(true)
    content.dispatchEvent(new CompositionEvent('compositionend'))
    expect(handle.view.dom.hasAttribute('data-mdx-composing')).toBe(false)
  })
})
