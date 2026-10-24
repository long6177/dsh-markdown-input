/**
 * The vendored sent-text projection (rc.0 `projectUserText` grammar over the
 * rc.2 public `UserTextRun` / `ReferenceChip` components), asserted from the
 * outside: render it and check what a reader sees — chip kinds, display
 * labels, hover titles, and the verbatim plain runs between chips. The
 * activation arm (#75) is pinned here too: with `references` actions the
 * file/skill chips render as buttons whose clicks preview (with the native
 * file-retry dialog on a failed open), without them everything stays a
 * display-only span.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectUserText } from '../src/client/user-text-projection.tsx'
import { resetReferenceLocale, setReferenceLocale } from '../src/client/reference-locale.ts'

afterEach(cleanup)

/** Render a projection to a container for DOM assertions. */
function project(
  text: string,
  sessionLabels: readonly string[] = [],
  slashNames: readonly string[] = [],
  references?: { openFile(path: string): void, openSkill(name: string): void },
  interactive = false,
): HTMLElement {
  const { container } = render(<>{projectUserText(text, sessionLabels, slashNames, references, interactive)}</>)
  return container
}

describe('vendored user-text projection (rc.0 grammar)', () => {
  it('renders reference-free text as one verbatim run without chips', () => {
    const container = project('just words\nsecond line')
    expect(container.querySelector('[data-ref-chip]')).toBeNull()
    expect(container.textContent).toBe('just words\nsecond line')
  })

  it('folds the wire session form into a session chip labeled with its display label', () => {
    const container = project('看 @[会话一](dsh-session:abc123) 的讨论')
    const chip = container.querySelector('[data-ref-chip="session"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('会话一')
    // The hover title keeps the raw wire form; the run text around it stays.
    expect(chip).toHaveAttribute('title', '@[会话一](dsh-session:abc123)')
    expect(container.textContent).toBe('看 会话一 的讨论')
  })

  it('chips an exact session-label mention as a session chip', () => {
    const container = project('@notes/file.md 看看这个', ['notes/file.md'])
    const chip = container.querySelector('[data-ref-chip="session"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('notes/file.md')
    expect(chip).toHaveAttribute('title', '@notes/file.md')
  })

  it('chips a shape-recognized @path as a file chip with the basename displayed', () => {
    const container = project('@notes/file.md 看看这个')
    const chip = container.querySelector('[data-ref-chip="file"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('file.md')
    expect(chip).toHaveAttribute('title', '@notes/file.md')
  })

  it('chips a trailing-slash @token as a folder chip', () => {
    const container = project('@notes/ 里有笔记')
    expect(container.querySelector('[data-ref-chip="folder"]')).not.toBeNull()
  })

  it('chips a quoted @"path with spaces" with the quotes stripped from display', () => {
    const container = project('@"my notes/file.md" 看看')
    const chip = container.querySelector('[data-ref-chip="file"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('file.md')
    expect(chip).toHaveAttribute('title', '@"my notes/file.md"')
  })

  it('sheds run-end sentence punctuation from a bare @token but keeps a quoted token verbatim', () => {
    // A token is the whole non-space run: only ITS trailing punctuation sheds.
    const bare = project('看看 @plan。')
    expect(bare.querySelector('[data-ref-chip="file"]')).toHaveAttribute('title', '@plan')
    const glued = project('@plan。好的')
    expect(glued.querySelector('[data-ref-chip="file"]')).toHaveAttribute('title', '@plan。好的')
    const quoted = project('看看 @"plan"。')
    expect(quoted.querySelector('[data-ref-chip="file"]')).toHaveAttribute('title', '@"plan"')
  })

  it('chips a loaded skill slash-form as a skill chip showing the slash form', () => {
    const container = project('/plan 列一下', [], ['plan'])
    const chip = container.querySelector('[data-ref-chip="skill"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('/plan')
    expect(chip).toHaveAttribute('title', '/plan')
  })

  it('keeps an unloaded /name as plain text', () => {
    const container = project('/plan 列一下')
    expect(container.querySelector('[data-ref-chip]')).toBeNull()
    expect(container.textContent).toBe('/plan 列一下')
  })

  it('keeps slash paths and punctuation-glued tokens plain even for a loaded name', () => {
    const path = project('/plan.md 好的', [], ['plan'])
    expect(path.querySelector('[data-ref-chip]')).toBeNull()
    const glued = project('/plan。好的', [], ['plan'])
    expect(glued.querySelector('[data-ref-chip]')).toBeNull()
  })

  it('lets the wire session form outrank an overlapping @ token at the same span', () => {
    const container = project('@[会话一](dsh-session:abc123)')
    expect(container.querySelectorAll('[data-ref-chip]')).toHaveLength(1)
    expect(container.querySelector('[data-ref-chip="session"]')).not.toBeNull()
  })

  it('keeps plain runs between chips verbatim for the Markdown partition', () => {
    const container = project('before @a.md mid /plan after', [], ['plan'])
    // Three inline siblings: run, chip, run, chip, run.
    expect(container.children).toHaveLength(5)
    expect(container.children[0]?.textContent).toBe('before ')
    expect(container.children[1]?.getAttribute('data-ref-chip')).toBe('file')
    expect(container.children[2]?.textContent).toBe(' mid ')
    expect(container.children[3]?.getAttribute('data-ref-chip')).toBe('skill')
    expect(container.children[4]?.textContent).toBe(' after')
  })
})

describe('activatable reference chips (#75)', () => {
  it('renders a file chip as a button that opens the decoded path', () => {
    const openFile = vi.fn()
    const openSkill = vi.fn()
    const container = project('看 @notes/file.md 一下', [], [], { openFile, openSkill })
    const chip = container.querySelector('button[data-ref-chip="file"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('file.md')
    fireEvent.click(chip!)
    expect(openFile).toHaveBeenCalledWith('notes/file.md')
    expect(openSkill).not.toHaveBeenCalled()
  })

  it('strips the boundary quotes from a quoted file path before opening', () => {
    const openFile = vi.fn()
    const container = project('看 @"my notes/file.md" 一下', [], [], { openFile, openSkill: vi.fn() })
    fireEvent.click(container.querySelector('button[data-ref-chip="file"]')!)
    expect(openFile).toHaveBeenCalledWith('my notes/file.md')
  })

  it('keeps folder and session chips display-only even with actions present', () => {
    const openFile = vi.fn()
    const container = project('@notes/ 里有 @[会话一](dsh-session:abc123)', [], [], { openFile, openSkill: vi.fn() })
    expect(container.querySelector('button[data-ref-chip]')).toBeNull()
    expect(container.querySelector('[data-ref-chip="folder"]')).not.toBeNull()
    expect(container.querySelector('[data-ref-chip="session"]')).not.toBeNull()
  })

  it('renders a skill chip as a button that previews the name', () => {
    const openSkill = vi.fn()
    const container = project('/plan 列一下', [], ['plan'], { openFile: vi.fn(), openSkill })
    const chip = container.querySelector('button[data-ref-chip="skill"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('/plan')
    fireEvent.click(chip!)
    expect(openSkill).toHaveBeenCalledWith('plan')
  })

  it('shows the retry dialog on a failed open, closes it, and replays the same open on retry', () => {
    const openFile = vi.fn(() => { throw new Error('no type accepts the address') })
    const container = project('看 @notes/file.md 一下', [], [], { openFile, openSkill: vi.fn() })
    const chip = container.querySelector('button[data-ref-chip="file"]')!
    fireEvent.click(chip)
    // The dialog speaks the native fileOpen words (the plugin fallback copy)
    // and names the failed path.
    expect(document.body.textContent).toContain('无法打开文件')
    expect(document.body.textContent).toContain('notes/file.md')
    const buttonByText = (text: string): HTMLButtonElement | undefined =>
      [...document.body.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement | undefined
    const close = buttonByText('关闭')
    expect(close).toBeDefined()
    fireEvent.click(close!)
    expect(document.body.textContent).not.toContain('无法打开“notes/file.md”')
    // Retry: the primary button replays the same open (still failing here).
    fireEvent.click(chip)
    expect(openFile).toHaveBeenCalledTimes(2)
  })

  it('does not activate on a repeated click (the native double-click guard)', () => {
    const openFile = vi.fn()
    const container = project('看 @notes/file.md 一下', [], [], { openFile, openSkill: vi.fn() })
    const chip = container.querySelector('button[data-ref-chip="file"]')!
    fireEvent.click(chip, { detail: 2 })
    expect(openFile).not.toHaveBeenCalled()
  })

  it('keeps display-only spans when the actions are absent', () => {
    const container = project('看 @notes/file.md /plan 一下', [], ['plan'])
    expect(container.querySelector('button[data-ref-chip]')).toBeNull()
    expect(container.querySelector('[data-ref-chip="file"]')).not.toBeNull()
    expect(container.querySelector('[data-ref-chip="skill"]')).not.toBeNull()
  })

  it('speaks the host fileOpen words when the reference namespace is bound', () => {
    setReferenceLocale(((key: string, params?: Record<string, unknown>) => {
      if (key === 'fileOpen.failed') return `bound ${String(params?.path)}`
      return String(key)
    }) as never)
    try {
      const openFile = vi.fn(() => { throw new Error('x') })
      const container = project('@a.md', [], [], { openFile, openSkill: vi.fn() })
      fireEvent.click(container.querySelector('button[data-ref-chip="file"]')!)
      expect(document.body.textContent).toContain('bound a.md')
    } finally {
      resetReferenceLocale()
    }
  })
})

describe('secret masking in the projection (#75)', () => {
  it('masks a credential with a reveal control in interactive text', () => {
    const container = project('token sk-abc123def456ghijklmn here', [], [], undefined, true)
    const secret = container.querySelector('[data-secret]')
    expect(secret).not.toBeNull()
    // The drawn text is the masked form; the plain runs around it stay verbatim.
    expect(secret?.textContent).toContain('sk-abc12***************')
    expect(container.textContent).toBe('token sk-abc12*************** here')
    const toggle = secret?.querySelector('button[aria-pressed]')
    expect(toggle).toHaveAttribute('aria-label', '显示密钥')
  })

  it('reveals the raw value on toggle and re-masks a different value at the same position', () => {
    const container = project('token sk-abc123def456ghijklmn here', [], [], undefined, true)
    const toggle = () => container.querySelector('[data-secret] button[aria-pressed]')!
    fireEvent.click(toggle())
    expect(container.querySelector('[data-secret]')?.textContent).toContain('sk-abc123def456ghijklmn')
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(toggle()).toHaveAttribute('aria-label', '隐藏密钥')
    // Toggling back re-masks (the revealed value, not a flag, is the state).
    fireEvent.click(toggle())
    expect(container.querySelector('[data-secret]')?.textContent).toContain('sk-abc12***************')
  })

  it('renders no reveal control in non-interactive text (the queue-preview posture)', () => {
    const container = project('token sk-abc123def456ghijklmn here')
    expect(container.querySelector('[data-secret]')?.textContent).toContain('sk-abc12***************')
    expect(container.querySelector('[data-secret] button')).toBeNull()
  })

  it('keeps an earlier reference chip whole over a secret inside it (cursor semantics)', () => {
    const container = project('@notes/sk-abc123def456ghijklmn.md 看看')
    // The file chip wins: the native rules walk the text and the earliest
    // match takes the span — a session/file chip's own label never masks.
    expect(container.querySelector('[data-ref-chip="file"]')).not.toBeNull()
    expect(container.querySelector('[data-secret]')).toBeNull()
  })

  it('masks a secret that starts ahead of a later reference token', () => {
    const container = project('sk-abc123def456ghijklmn and @notes/a.md', [], [], undefined, true)
    expect(container.querySelector('[data-secret]')).not.toBeNull()
    expect(container.querySelector('[data-ref-chip="file"]')).not.toBeNull()
  })
})
