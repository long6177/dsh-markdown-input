/**
 * The user-message Markdown hardener (#53-adjacent render fix core): soft
 * line breaks become hard ones outside fenced code, so the bubble shows the
 * lines the author typed. Pure text in, pure text out.
 */
import { describe, expect, it } from 'vitest'
import { hardenSoftBreaks } from '../src/client/user-markdown.ts'

describe('hardenSoftBreaks', () => {
  it('hardens the maintainer\'s three-line message so the continuation line survives rendering', () => {
    expect(hardenSoftBreaks('1. 你好\n2. asdfao\nafsdfa'))
      .toBe('1. 你好  \n2. asdfao  \nafsdfa')
  })

  it('leaves fenced code interiors untouched — fences included', () => {
    const text = 'before\n```text\n1. a\n2. b\n```\nafter'
    expect(hardenSoftBreaks(text)).toBe('before  \n```text\n1. a\n2. b\n```\nafter')
  })

  it('handles tilde fences and a longer closing run', () => {
    const text = '~~~\nx\n~~~~~\na\nb'
    expect(hardenSoftBreaks(text)).toBe('~~~\nx\n~~~~~\na  \nb')
  })

  it('a fence only closes on its own character, long enough, with nothing after it', () => {
    // Too-short run and a trailing word both leave the fence open: the rest
    // of the document stays interior (CommonMark's rule).
    expect(hardenSoftBreaks('~~~\nx\n~~\ny')).toBe('~~~\nx\n~~\ny')
    expect(hardenSoftBreaks('```\ncode\n``` trailing\nafter')).toBe('```\ncode\n``` trailing\nafter')
  })

  it('keeps blank lines blank, the last line untouched, and is idempotent', () => {
    expect(hardenSoftBreaks('a\n\nb')).toBe('a  \n\nb')
    expect(hardenSoftBreaks('a\n')).toBe('a  \n')
    expect(hardenSoftBreaks('a  \nb')).toBe('a  \nb')
    // Whitespace-only lines are blank lines to the block grammar.
    expect(hardenSoftBreaks('a\n \nb')).toBe('a  \n \nb')
  })

  it('leaves an indented code block untouched (no hard break inside code)', () => {
    const text = 'intro\n\n    code one\n    code two\n\n    code three\ntail\nlast'
    expect(hardenSoftBreaks(text))
      .toBe('intro  \n\n    code one\n    code two\n\n    code three\ntail  \nlast')
  })

  it('starts an indented block at the document start and with a tab', () => {
    expect(hardenSoftBreaks('    first\n    second\ntail'))
      .toBe('    first\n    second\ntail')
    expect(hardenSoftBreaks('intro\n\n\tcode\ntail\nlast'))
      .toBe('intro  \n\n\tcode\ntail  \nlast')
  })

  it('does not treat a list continuation line as an indented code block', () => {
    // Without the blank-line boundary the four-space line is a list item's
    // continuation, where the break must stay visible.
    expect(hardenSoftBreaks('- item\n    continuation\n  next'))
      .toBe('- item  \n    continuation  \n  next')
  })

  it('leaves table rows untouched, delimiter row included', () => {
    const text = 'intro\n| a | b |\n| --- | --- |\n| 1 | 2 |\ntail\nlast'
    expect(hardenSoftBreaks(text))
      .toBe('intro  \n| a | b |\n| --- | --- |\n| 1 | 2 |\ntail  \nlast')
  })
})
