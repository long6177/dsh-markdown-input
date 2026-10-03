/**
 * Seam: the reference-chip scan — the pure decision core behind the
 * takeover editor's chip decorations (T9). Host parity lives here:
 * `/name` follows the composer text-ref grammar (whitespace boundary,
 * whitespace/end tail, exact hot-dictionary hit); `@` follows the
 * sent-text projection grammar (wire session form folds, quoted and bare
 * shape tokens, trailing punctuation stripped, trailing slash = folder).
 */
import { describe, expect, it } from 'vitest'
import { scanRefChips, type RefChipRange } from '../src/client/ref-chips.ts'

/** Short helper: scan with a skill roll, returning `kind start-end` strings. */
function scan(text: string, skills: readonly string[] = []): string[] {
  return scanRefChips(text, new Set(skills)).map(
    (chip: RefChipRange) => `${chip.kind} ${chip.start}-${chip.end}`,
  )
}

describe('scanRefChips — empty and plain text', () => {
  it('answers empty for an empty draft', () => {
    expect(scan('')).toEqual([])
  })

  it('answers empty for text without reference shapes', () => {
    expect(scan('hello world, 一段普通文本 123')).toEqual([])
  })
})

describe('scanRefChips — @ file and folder shapes', () => {
  it('decorates a bare word token as a file', () => {
    expect(scan('see @notes today')).toEqual(['file 4-10'])
  })

  it('decorates a dotted and slashed path as a file', () => {
    expect(scan('open @src/client/index.ts please')).toEqual(['file 5-25'])
  })

  it('decorates a trailing-slash token as a folder', () => {
    expect(scan('check @src/ now')).toEqual(['folder 6-11'])
  })

  it('decorates the quoted whitespace form as a file', () => {
    expect(scan('@"path with spaces" end')).toEqual(['file 0-19'])
  })

  it('decorates the quoted whitespace form with a trailing slash as a folder', () => {
    expect(scan('@"my folder/" next')).toEqual(['folder 0-13'])
  })

  it('strips trailing sentence punctuation from a bare token', () => {
    expect(scan('看看 @a.txt。 好')).toEqual(['file 3-9'])
    expect(scan('ping @server, then')).toEqual(['file 5-12'])
  })

  it('keeps punctuation inside a quoted token', () => {
    expect(scan('@"v1.0, final" ok')).toEqual(['file 0-14'])
  })

  it('never decorates a bare @ alone', () => {
    expect(scan('email me @ please')).toEqual([])
  })

  it('never decorates a mid-word @ (email-like text)', () => {
    expect(scan('contact foo@gmail.com now')).toEqual([])
  })

  it('matches at a newline boundary but not mid-word', () => {
    expect(scan('first\n@a.txt')).toEqual(['file 6-12'])
  })

  it('decorates an unclosed quoted prefix as a bare token (live typing)', () => {
    expect(scan('@"one-word')).toEqual(['file 0-10'])
  })
})

describe('scanRefChips — /skill dictionary hits', () => {
  const skills = ['read-file', 'plan']

  it('decorates an exact lexicon hit followed by whitespace', () => {
    expect(scan('use /read-file to load', skills)).toEqual(['skill 4-14'])
  })

  it('decorates an exact lexicon hit at the draft end', () => {
    expect(scan('run /plan', skills)).toEqual(['skill 4-9'])
  })

  it('decorates multiple hits in draft order', () => {
    expect(scan('/plan then /read-file', skills)).toEqual(['skill 0-5', 'skill 11-21'])
  })

  it('keeps a slash path plain (no whitespace end)', () => {
    expect(scan('open /read-file/x here', skills)).toEqual([])
  })

  it('keeps a punctuation-glued token plain (prose)', () => {
    expect(scan('use /read-file。thanks', skills)).toEqual([])
    expect(scan('run /plan,now', skills)).toEqual([])
  })

  it('keeps a mid-word trigger plain', () => {
    expect(scan('x/plan now', skills)).toEqual([])
  })

  it('is case-sensitive on the dictionary', () => {
    expect(scan('use /PLAN now', skills)).toEqual([])
  })

  it('decorates nothing when the lexicon is empty (face missing → plain text)', () => {
    expect(scan('use /read-file now', [])).toEqual([])
  })
})

describe('scanRefChips — session wire form', () => {
  it('decorates the wire mention as a session chip', () => {
    expect(scan('see @[Old chat](dsh-session:s-1) please')).toEqual(['session 4-32'])
  })

  it('accepts labels with spaces and brackets-free content', () => {
    expect(scan('@[A B C](dsh-session:x1) end')).toEqual(['session 0-24'])
  })

  it('keeps a malformed wire form to the shape grammar instead', () => {
    // No closing paren on the session URI: not a session chip; the bare
    // shape token still decorates (bubble presentation parity).
    expect(scan('@[label](dsh-session:x more')).toEqual(['file 0-22'])
  })

  it('does not cross a newline inside the label', () => {
    expect(scan('@[a\nb](dsh-session:x)')).toEqual(['file 0-3'])
  })
})

describe('scanRefChips — precedence and overlap', () => {
  it('the session wire wins over the bare shape token at the same span', () => {
    expect(scan('@[label](dsh-session:x)')).toEqual(['session 0-23'])
  })

  it('the quoted token wins over its bare fragments', () => {
    expect(scan('@"a b" c')).toEqual(['file 0-6'])
  })

  it('keeps a skill hit and a later file token side by side', () => {
    expect(scan('/plan and @a.txt', ['plan'])).toEqual(['skill 0-5', 'file 10-16'])
  })

  it('never returns overlapping ranges', () => {
    const text = '@[a](dsh-session:x) @"b c" /plan @d/ tail'
    const chips = scanRefChips(text, new Set(['plan']))
    for (let i = 1; i < chips.length; i++) {
      expect(chips[i]!.start).toBeGreaterThanOrEqual(chips[i - 1]!.end)
    }
  })
})
