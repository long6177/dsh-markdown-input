/**
 * Seam: the completion popups' pure decision core (T10). Pins the host
 * trigger grammar (the `@` shared token grammar, the `/` word-boundary and
 * URL carve-outs, leading/inline positions), the mention formatting rules
 * the wire requires (`@path` / `@"path with spaces"`, open quotes on drilled
 * directories, unrepresentable paths dropped), the guard tiers, the
 * dismissed-memory identity, and the group assembly — sectioned rows at the
 * empty slash query, rankByName ordering (prefix hits first) with source
 * group titles otherwise, the pending/stale stale-while-revalidate shapes,
 * and the slash popup hiding when the command plane is absent.
 */
import { describe, expect, it } from 'vitest'
import {
  assembleCompletionView, detectCompletion, formatFileMention, guardAllowsProbe,
  sameProbeIdentity, skillInsertion,
  type CompletionProbe, type FileReferenceCandidate,
} from '../src/client/completion-core.ts'
import type { CommandMenuRow } from '../src/client/command-rows.ts'
import { en, zh } from '../src/client/locales.ts'

function fakeT(locale: Record<string, string>): (key: keyof typeof zh, params?: Record<string, string>) => string {
  return ((key: string, params?: Record<string, string>) => {
    const template = locale[key] ?? key
    return template.replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
  }) as (key: keyof typeof zh, params?: Record<string, string>) => string
}
const tZh = fakeT(zh)
const tEn = fakeT(en)

function probe(partial: Partial<CompletionProbe>): CompletionProbe {
  return { trigger: '/', query: '', quoted: false, position: 'leading', start: 0, end: 1, ...partial }
}

function commandRow(name: string, section: string, extra: Partial<CommandMenuRow> = {}): CommandMenuRow {
  return { name, label: name, kind: 'execute', section, ...extra }
}

describe('detectCompletion — @ grammar', () => {
  it('tracks a bare @ token at the draft head as leading', () => {
    expect(detectCompletion('@in', 3)).toEqual(probe({
      trigger: '@', query: 'in', start: 0, end: 3,
    }))
  })

  it('tracks an inline @ token after text', () => {
    const hit = detectCompletion('see @in', 7)
    expect(hit).toEqual(probe({
      trigger: '@', query: 'in', position: 'inline', start: 4, end: 7,
    }))
  })

  it('tracks an open quoted token with spaces inside', () => {
    // The ^ boundary is zero-width, so a draft-leading quote starts at 0.
    const hit = detectCompletion('@"src fo', 8)
    expect(hit).toEqual(probe({
      trigger: '@', query: 'src fo', quoted: true, start: 0, end: 8,
    }))
  })

  it('does not trigger inside another token (email addresses)', () => {
    expect(detectCompletion('mail a@b.com', 12)).toBeNull()
    expect(detectCompletion('a@b', 3)).toBeNull()
  })

  it('closes the token at whitespace (a bare @ cannot span it)', () => {
    expect(detectCompletion('@in file', 8)).toBeNull()
  })
})

describe('detectCompletion — / grammar', () => {
  it('tracks a bare slash with its empty query as leading', () => {
    expect(detectCompletion('/', 1)).toEqual(probe({ trigger: '/', query: '', start: 0, end: 1 }))
  })

  it('tracks an inline slash token after whitespace', () => {
    const hit = detectCompletion('run /comp', 9)
    expect(hit).toEqual(probe({
      trigger: '/', query: 'comp', position: 'inline', start: 4, end: 9,
    }))
  })

  it('keeps the query mid-token', () => {
    expect(detectCompletion('/goal', 3)?.query).toBe('go')
  })

  it('never triggers inside a word (24/7, and/or)', () => {
    expect(detectCompletion('24/7', 4)).toBeNull()
    expect(detectCompletion('and/or', 6)).toBeNull()
  })

  it('keeps slashes dead inside URLs (the // and :// carve-outs)', () => {
    expect(detectCompletion('https://a.b/c', 13)).toBeNull()
    expect(detectCompletion('file://x', 8)).toBeNull()
  })

  it('stops the scan at whitespace', () => {
    expect(detectCompletion('/a b', 4)).toBeNull()
  })

  it('does not leak a slash token out of a previous word position', () => {
    expect(detectCompletion('x /a', 1)).toBeNull()
  })
})

describe('guardAllowsProbe', () => {
  const slash = probe({ trigger: '/' })
  const at = probe({ trigger: '@' })
  it('arms both triggers on the plain tier', () => {
    expect(guardAllowsProbe('plain', slash)).toBe(true)
    expect(guardAllowsProbe('plain', at)).toBe(true)
  })
  it('suppresses / while a command claim holds, keeping @ live', () => {
    expect(guardAllowsProbe('claimed', slash)).toBe(false)
    expect(guardAllowsProbe('claimed', at)).toBe(true)
  })
  it('suppresses both while frozen', () => {
    expect(guardAllowsProbe('frozen', slash)).toBe(false)
    expect(guardAllowsProbe('frozen', at)).toBe(false)
  })
})

describe('sameProbeIdentity', () => {
  it('compares trigger, query, quote, and span', () => {
    const base = probe({ trigger: '@', query: 'a', quoted: true, start: 2, end: 5 })
    expect(sameProbeIdentity(base, probe({ trigger: '@', query: 'a', quoted: true, start: 2, end: 5 }))).toBe(true)
    expect(sameProbeIdentity(base, probe({ trigger: '@', query: 'ab', quoted: true, start: 2, end: 6 }))).toBe(false)
    expect(sameProbeIdentity(base, probe({ trigger: '@', query: 'a', quoted: false, start: 2, end: 5 }))).toBe(false)
    expect(sameProbeIdentity(base, null)).toBe(false)
    expect(sameProbeIdentity(null, null)).toBe(true)
  })
})

describe('formatFileMention', () => {
  it('writes bare mentions for plain paths', () => {
    expect(formatFileMention({ path: 'src/index.ts', kind: 'file' }, false)).toBe('@src/index.ts')
  })

  it('quotes paths with whitespace', () => {
    expect(formatFileMention({ path: 'my docs/report final.pdf', kind: 'file' }, false))
      .toBe('@"my docs/report final.pdf"')
  })

  it('gives directories the trailing slash', () => {
    expect(formatFileMention({ path: 'src', kind: 'directory' }, false)).toBe('@src/')
  })

  it('keeps an explicitly opened quote open on directories (drill descent)', () => {
    expect(formatFileMention({ path: 'my docs', kind: 'directory' }, true)).toBe('@"my docs/')
    expect(formatFileMention({ path: 'src', kind: 'directory' }, true)).toBe('@"src/')
  })

  it('closes the quote on files even when the quote was opened explicitly', () => {
    expect(formatFileMention({ path: 'src/index.ts', kind: 'file' }, true)).toBe('@"src/index.ts"')
  })

  it('drops paths the grammar cannot represent safely', () => {
    expect(formatFileMention({ path: 'we"ird', kind: 'file' }, false)).toBeUndefined()
    expect(formatFileMention({ path: 'tab\there', kind: 'file' }, false)).toBeUndefined()
  })
})

describe('skillInsertion', () => {
  it('inserts the token with its trailing space (the skill gesture boundary)', () => {
    expect(skillInsertion('review')).toBe('/review ')
  })
})

describe('assembleCompletionView — / trigger', () => {
  const rows: readonly CommandMenuRow[] = [
    commandRow('file', '添加', { kind: 'action' }),
    commandRow('goal', '添加', { kind: 'claim' }),
    commandRow('compact', '指令'),
    commandRow('custom', '指令'),
  ]

  it('shows the sectioned rows at the empty query with the pending skill group', () => {
    const view = assembleCompletionView({
      probe: probe({ trigger: '/', query: '' }), commandRows: rows, skills: null,
      files: null, staleFiles: null, t: tZh,
    })
    expect(view).not.toBeNull()
    expect(view?.groups.map((group) => group.id)).toEqual(['command', 'skill'])
    expect(view?.groups[0]?.title).toBeUndefined()
    expect(view?.groups[0]?.entries.map((entry) => entry.section)).toEqual(['添加', '添加', '指令', '指令'])
    expect(view?.groups[0]?.entries.map((entry) => entry.option.row.name)).toEqual(['file', 'goal', 'compact', 'custom'])
    expect(view?.groups[1]).toMatchObject({ status: 'pending', title: '技能' })
    expect(view?.pending).toBe(true)
  })

  it('ranks both groups by the query with prefix hits first and group titles on', () => {
    const view = assembleCompletionView({
      probe: probe({ trigger: '/', query: 'co' }), commandRows: rows,
      skills: [{ name: 'core-review' }, { name: 'unrelated' }],
      files: null, staleFiles: null, t: tZh,
    })
    expect(view?.groups[0]).toMatchObject({ id: 'command', title: '指令', status: 'ready' })
    // Prefix hit 'compact' outranks the subsequence 'custom'; 'file'/'goal' miss.
    expect(view?.groups[0]?.entries.map((entry) => entry.option.row.name)).toEqual(['compact', 'custom'])
    expect(view?.groups[0]?.entries.every((entry) => entry.section === undefined)).toBe(true)
    expect(view?.groups[1]?.entries.map((entry) => (entry.option as { name: string }).name)).toEqual(['core-review'])
    expect(view?.pending).toBe(false)
  })

  it('matches skill labels case-insensitively and keeps the skill title', () => {
    const view = assembleCompletionView({
      probe: probe({ trigger: '/', query: 'REV' }), commandRows: rows,
      skills: [{ name: 'core-review' }], files: null, staleFiles: null, t: tEn,
    })
    expect(view?.groups[1]?.title).toBe('Skills')
    expect(view?.groups[1]?.entries).toHaveLength(1)
  })

  it('marks user-only skills in the description', () => {
    const view = assembleCompletionView({
      probe: probe({ trigger: '/', query: '' }), commandRows: rows,
      skills: [{ name: 'manual', description: 'hand run', modelInvocable: false }, { name: 'auto', description: 'both' }],
      files: null, staleFiles: null, t: tZh,
    })
    const names = view?.groups[1]?.entries.map((entry) => (entry.option as { description?: string }).description)
    expect(names).toEqual(['仅用户 · hand run', 'both'])
  })

  it('hides the whole view while the command plane is absent', () => {
    expect(assembleCompletionView({
      probe: probe({ trigger: '/' }), commandRows: null, skills: [],
      files: null, staleFiles: null, t: tZh,
    })).toBeNull()
  })
})

describe('assembleCompletionView — @ trigger', () => {
  const files: readonly FileReferenceCandidate[] = [
    { path: 'src/index.ts', kind: 'file' },
    { path: 'src', kind: 'directory' },
    { path: 'README.md', kind: 'file' },
  ]

  it('projects candidates with basenames, parents, and the section title', () => {
    const view = assembleCompletionView({
      probe: probe({ trigger: '@', query: 'src', position: 'inline', start: 2, end: 5 }),
      commandRows: null, skills: null, files, staleFiles: null, t: tZh,
    })
    expect(view?.groups).toHaveLength(1)
    expect(view?.groups[0]).toMatchObject({ id: 'file', status: 'ready' })
    const options = view?.groups[0]?.entries.map((entry) => entry.option) ?? []
    expect(options.map((option) => (option as { label: string }).label)).toEqual(['index.ts', 'src', 'README.md'])
    expect(options.map((option) => (option as { parent: string }).parent)).toEqual(['src', '', ''])
    expect(options.map((option) => (option as { mention: string }).mention)).toEqual(['@src/index.ts', '@src/', '@README.md'])
    expect(view?.groups[0]?.entries.every((entry) => entry.section === '文件与文件夹')).toBe(true)
    expect(view?.pending).toBe(false)
  })

  it('keeps an open quote on mentions while the token is quoted', () => {
    const view = assembleCompletionView({
      probe: probe({ trigger: '@', query: 'src', quoted: true, start: 1, end: 5 }),
      commandRows: null, skills: null,
      files: [{ path: 'my docs', kind: 'directory' }, { path: 'notes.md', kind: 'file' }],
      staleFiles: null, t: tZh,
    })
    const mentions = view?.groups[0]?.entries.map((entry) => (entry.option as { mention: string }).mention)
    expect(mentions).toEqual(['@"my docs/', '@"notes.md"'])
  })

  it('shows the pending skeleton with no stale results', () => {
    const view = assembleCompletionView({
      probe: probe({ trigger: '@', query: 'a' }), commandRows: null, skills: null,
      files: null, staleFiles: null, t: tZh,
    })
    expect(view?.groups[0]).toMatchObject({ id: 'file', status: 'pending', entries: [] })
    expect(view?.pending).toBe(true)
  })

  it('keeps the previous results visible while refining (stale-while-revalidate)', () => {
    const view = assembleCompletionView({
      probe: probe({ trigger: '@', query: 'ab' }), commandRows: null, skills: null,
      files: null, staleFiles: files, t: tZh,
    })
    expect(view?.groups[0]?.status).toBe('pending')
    expect(view?.groups[0]?.entries).toHaveLength(3)
    expect(view?.pending).toBe(true)
  })

  it('lands an empty result as a ready-empty group (no skeleton)', () => {
    const view = assembleCompletionView({
      probe: probe({ trigger: '@', query: 'zzz' }), commandRows: null, skills: null,
      files: [], staleFiles: files, t: tZh,
    })
    expect(view?.groups[0]).toMatchObject({ id: 'file', status: 'ready', entries: [] })
    expect(view?.pending).toBe(false)
  })

  it('drops unformattable paths from the projection', () => {
    const view = assembleCompletionView({
      probe: probe({ trigger: '@', query: '' }), commandRows: null, skills: null,
      files: [{ path: 'we"ird', kind: 'file' }, { path: 'ok.md', kind: 'file' }],
      staleFiles: null, t: tZh,
    })
    expect(view?.groups[0]?.entries).toHaveLength(1)
  })
})
