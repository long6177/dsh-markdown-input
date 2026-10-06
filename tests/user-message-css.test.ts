/**
 * Seam: the user-message bubble's list skin (the third feedback round) —
 * inside positioning keeps the marker on the item's first line, so a
 * continuation line sits at the bubble's text edge while the item text
 * reads a level in. Pinned as sheet text (the issue #44 pattern): jsdom has
 * no layout and the sheet is the shipped artifact.
 */
import { describe, expect, it } from 'vitest'
import { readSheet, ruleOf } from './sheet.ts'

const bubbleCss = readSheet('../src/client/UserMessage.module.css')

describe('user-message bubble list CSS contract (third feedback round)', () => {
  it('rides the marker on the item line and lets continuation lines sit at the text edge', () => {
    const rule = ruleOf(bubbleCss, '.bubble :global(ol), .bubble :global(ul)')
    expect(rule).toContain('list-style-position: inside')
    expect(rule).toContain('padding-left: 0')
  })
})
