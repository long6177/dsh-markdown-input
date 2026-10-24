/**
 * Seam: the user-message bubble's list skin (the fourth feedback round) —
 * outside positioning keeps the marker in the list's hanging column, so a
 * continuation line aligns with the item text (mainstream markdown render,
 * the maintainer's decision to read mainstream after the third round's
 * inside/inside-out experiment). Pinned as sheet text (the issue #44
 * pattern): jsdom has no layout and the sheet is the shipped artifact.
 */
import { describe, expect, it } from 'vitest'
import { readSheet, ruleOf } from './sheet.ts'

const bubbleCss = readSheet('../src/client/UserMessage.module.css')

describe('user-message bubble list CSS contract (fourth feedback round)', () => {
  it('hangs the marker in the list padding so continuation lines align with the item text', () => {
    const rule = ruleOf(bubbleCss, '.bubble :global(ol), .bubble :global(ul)')
    expect(rule).toContain('list-style-position: outside')
    expect(rule).toContain('padding-left: 2em')
  })
})

describe('user-message bubble container contract (#77 echo handoff)', () => {
  it('speaks the host bubble’s class values so the echo→durable handoff has no style jump', () => {
    // The echo bubble renders inside the host MessageItem's own `.bubble`
    // (background token, radius token, 10/16 padding, content font metrics);
    // the durable bubble renders THIS sheet — the values must be the host's,
    // or the admitted bubble visibly repaints at admission.
    const rule = ruleOf(bubbleCss, '.bubble')
    expect(rule).toContain('background: var(--dsw-specific-bubble)')
    expect(rule).toContain('border-radius: var(--dsw-radius-xl)')
    expect(rule).toContain('padding: 10px 16px')
    expect(rule).toContain('font-size: var(--dsh-content-font-size, 14px)')
    expect(rule).toContain('line-height: calc(22px + var(--dsh-content-font-delta, 0px))')
    expect(rule).toContain('color: var(--dsw-alias-label-primary)')
  })

  it('caps the stack the way the host userStack does (width share, not a bare percent)', () => {
    const rule = ruleOf(bubbleCss, '.stack')
    expect(rule).toContain('gap: 8px')
    expect(rule).toContain('max-width: min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%)')
  })
})
