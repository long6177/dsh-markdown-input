/**
 * Seam tests for the L1 paint layer's syntax range parser: raw draft text
 * in, absolute inline-mark ranges out. The parser is the pure core of the
 * paint engine — markers and content ranges feed the DOM range mapping and
 * the highlight registration, so offsets must be exact and matches must
 * never overlap a code span.
 */
import { describe, expect, it } from 'vitest'
import { parseInlineMarks } from '../src/client/inline-syntax.ts'

describe('parseInlineMarks: the inline four', () => {
  it('ranges bold with both ** markers dimmed and content colored', () => {
    expect(parseInlineMarks('**bold**')).toEqual([{
      type: 'bold',
      markers: [{ start: 0, end: 2 }, { start: 6, end: 8 }],
      content: { start: 2, end: 6 },
    }])
  })

  it('ranges the __ bold form', () => {
    expect(parseInlineMarks('__bold__')).toEqual([{
      type: 'bold',
      markers: [{ start: 0, end: 2 }, { start: 6, end: 8 }],
      content: { start: 2, end: 6 },
    }])
  })

  it('ranges italic with single * markers', () => {
    expect(parseInlineMarks('*it*')).toEqual([{
      type: 'italic',
      markers: [{ start: 0, end: 1 }, { start: 3, end: 4 }],
      content: { start: 1, end: 3 },
    }])
  })

  it('ranges strikethrough with ~~ markers', () => {
    expect(parseInlineMarks('~~gone~~')).toEqual([{
      type: 'strike',
      markers: [{ start: 0, end: 2 }, { start: 6, end: 8 }],
      content: { start: 2, end: 6 },
    }])
  })
})

describe('parseInlineMarks: code spans', () => {
  it('ranges a code span and keeps it opaque to the other syntax', () => {
    // Bold markers inside a code span are literal text, not syntax.
    expect(parseInlineMarks('`**x**`')).toEqual([{
      type: 'code',
      markers: [{ start: 0, end: 1 }, { start: 6, end: 7 }],
      content: { start: 1, end: 6 },
    }])
  })

  it('matches double-backtick spans containing single backticks', () => {
    expect(parseInlineMarks('``a`b``')).toEqual([{
      type: 'code',
      markers: [{ start: 0, end: 2 }, { start: 5, end: 7 }],
      content: { start: 2, end: 5 },
    }])
  })

  it('ranges several code spans in one line', () => {
    const marks = parseInlineMarks('`a` and `b`')
    expect(marks).toHaveLength(2)
    expect(marks[0]).toEqual({
      type: 'code',
      markers: [{ start: 0, end: 1 }, { start: 2, end: 3 }],
      content: { start: 1, end: 2 },
    })
    expect(marks[1]).toEqual({
      type: 'code',
      markers: [{ start: 8, end: 9 }, { start: 10, end: 11 }],
      content: { start: 9, end: 10 },
    })
  })
})

describe('parseInlineMarks: precedence and nesting', () => {
  it('never re-ranges bold markers as italic', () => {
    const marks = parseInlineMarks('**bold**')
    expect(marks).toHaveLength(1)
    expect(marks[0]?.type).toBe('bold')
  })

  it('lets italic pair around a nested bold segment', () => {
    // *a **b** c* is em(strong(b)) in CommonMark; the flat projection keeps
    // both: bold inside, italic spanning the whole segment.
    const marks = parseInlineMarks('*a **b** c*')
    expect(marks).toHaveLength(2)
    expect(marks[0]).toEqual({
      type: 'bold',
      markers: [{ start: 3, end: 5 }, { start: 6, end: 8 }],
      content: { start: 5, end: 6 },
    })
    expect(marks[1]).toEqual({
      type: 'italic',
      markers: [{ start: 0, end: 1 }, { start: 10, end: 11 }],
      content: { start: 1, end: 10 },
    })
  })

  it('degrades triple markers to the longest form without nesting', () => {
    // `***x***` is strong+em in CommonMark; the flat projection keeps one
    // bold mark and leaves no stray italic behind.
    const marks = parseInlineMarks('***x***')
    expect(marks).toHaveLength(1)
    expect(marks[0]?.type).toBe('bold')
  })

  it('ranges several independent segments in one line', () => {
    const marks = parseInlineMarks('**b** then *i*')
    expect(marks).toHaveLength(2)
    expect(marks[0]?.type).toBe('bold')
    expect(marks[1]).toEqual({
      type: 'italic',
      markers: [{ start: 11, end: 12 }, { start: 13, end: 14 }],
      content: { start: 12, end: 13 },
    })
  })

  it('keeps strike, bold, and code side by side', () => {
    const marks = parseInlineMarks('~~s~~ **b** `c`')
    // Pass order: code spans are scanned first, then strike, then bold.
    expect(marks.map(mark => mark.type)).toEqual(['code', 'strike', 'bold'])
  })
})

describe('parseInlineMarks: refusals', () => {
  it('leaves unclosed markers as literal text', () => {
    expect(parseInlineMarks('**bold')).toEqual([])
    expect(parseInlineMarks('*it')).toEqual([])
    expect(parseInlineMarks('`code')).toEqual([])
    expect(parseInlineMarks('~~gone')).toEqual([])
  })

  it('leaves empty and whitespace-only content as literal text', () => {
    expect(parseInlineMarks('****')).toEqual([])
    expect(parseInlineMarks('** **')).toEqual([])
    expect(parseInlineMarks('``')).toEqual([])
    expect(parseInlineMarks('~~ ~~')).toEqual([])
  })

  it('refuses intra-word underscore emphasis', () => {
    expect(parseInlineMarks('snake_case_name')).toEqual([])
    expect(parseInlineMarks('a__b__c')).toEqual([])
  })

  it('allows intra-word asterisk emphasis like CommonMark', () => {
    expect(parseInlineMarks('a*b*c')).toEqual([{
      type: 'italic',
      markers: [{ start: 1, end: 2 }, { start: 3, end: 4 }],
      content: { start: 2, end: 3 },
    }])
    expect(parseInlineMarks('a**b**c')).toEqual([{
      type: 'bold',
      markers: [{ start: 1, end: 3 }, { start: 4, end: 6 }],
      content: { start: 3, end: 4 },
    }])
  })

  it('leaves arithmetic and spaced markers alone', () => {
    expect(parseInlineMarks('2 * 3 * 4')).toEqual([])
    expect(parseInlineMarks('a ~ b ~ c')).toEqual([])
  })

  it('leaves escaped markers as literal text', () => {
    expect(parseInlineMarks('\\*not bold\\*')).toEqual([])
    expect(parseInlineMarks('\\_not italic\\_')).toEqual([])
    expect(parseInlineMarks('\\`not code\\`')).toEqual([])
    expect(parseInlineMarks('\\~not strike\\~')).toEqual([])
  })

  it('pairs a real segment after an escaped marker', () => {
    expect(parseInlineMarks('\\*no* *yes*')).toEqual([{
      type: 'italic',
      markers: [{ start: 6, end: 7 }, { start: 10, end: 11 }],
      content: { start: 7, end: 10 },
    }])
  })
})

describe('parseInlineMarks: line discipline', () => {
  it('never pairs markers across a newline', () => {
    expect(parseInlineMarks('**a\nb**')).toEqual([])
    expect(parseInlineMarks('`a\nb`')).toEqual([])
  })

  it('reports absolute offsets across multiple lines', () => {
    const marks = parseInlineMarks('plain\n**bold**\ntail')
    expect(marks).toEqual([{
      type: 'bold',
      markers: [{ start: 6, end: 8 }, { start: 12, end: 14 }],
      content: { start: 8, end: 12 },
    }])
  })

  it('answers empty for empty and marker-free input', () => {
    expect(parseInlineMarks('')).toEqual([])
    expect(parseInlineMarks('plain text only')).toEqual([])
  })
})
