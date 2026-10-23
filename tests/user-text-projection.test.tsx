/**
 * The vendored sent-text projection (rc.0 `projectUserText` grammar over the
 * rc.2 public `UserTextRun` / `ReferenceChip` components), asserted from the
 * outside: render it and check what a reader sees — chip kinds, display
 * labels, hover titles, and the verbatim plain runs between chips.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { projectUserText } from '../src/client/user-text-projection.tsx'

afterEach(cleanup)

/** Render a projection to a container for DOM assertions. */
function project(text: string, sessionLabels: readonly string[] = [], slashNames: readonly string[] = []): HTMLElement {
  const { container } = render(<>{projectUserText(text, sessionLabels, slashNames)}</>)
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
