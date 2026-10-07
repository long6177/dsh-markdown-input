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
