/**
 * Signal collection for the drift watch (#59): `collectSignals` orchestrates
 * the four routes over an INJECTED `fetchJson` (no network in tests), and
 * `pickTargetVersion`/`readPinnedFace`/`parseSuiteResult` are pure. Endpoint
 * URLs are asserted exactly so a GitHub/npm API shape change fails here
 * first.
 */
import { describe, expect, it } from 'vitest'
import {
  collectSignals,
  parseSuiteResult,
  pickTargetVersion,
  readPinnedFace,
  toCommitSummary,
  urls,
} from '../scripts/drift-watch.mjs'

/** The pinned face mirrors the real package.json (7 @deepseek-ai/* packages). */
const PINNED = {
  packages: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-chat',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-util-code-language',
    '@deepseek-ai/dsh-util-workspace-path',
  ],
  baseVersion: '0.2.0-rc.2',
  peerRange: '^0.2.0-rc.2',
  cordisPeerRange: '*',
}

const WATCHLIST = {
  paths: [
    { path: 'docs/subsystems/slots.md', kind: 'contract-doc', reason: '官方槽位契约文档', faces: ['all'] },
    { path: 'packages/client/ui-conversation/src/client/contract/slots.ts', kind: 'slot', reason: '槽位键契约', faces: ['composer-takeover'] },
    { path: 'packages/client/locale/src/locales/en.ts', kind: 'locale', reason: 'en 词典源', faces: ['locale-dicts'] },
  ],
}

/** Minimal but shape-faithful fixtures for the four routes. */
function makeFetchJson(options: {
  newerNpmVersion?: string
  hitPaths?: string[]
  newerTag?: string
  cordisTag?: { tag: string, version: string }
}) {
  const calls: string[] = []
  return {
    calls,
    async fetchJson(url: string) {
      calls.push(url)
      if (url === urls.npmPackument('@deepseek-ai/dsh')) {
        return {
          'dist-tags': { alpha: options.newerNpmVersion ?? '0.2.1-alpha.1', next: '0.2.0-rc.2', latest: '0.2.0-rc.2' },
          time: {
            '0.2.0-rc.2': '2026-09-14T08:00:00.000Z',
            ...(options.newerNpmVersion ? { [options.newerNpmVersion]: '2026-09-30T08:00:00.000Z' } : {}),
          },
          versions: {
            '0.2.0-rc.2': {},
            ...(options.newerNpmVersion ? { [options.newerNpmVersion]: {} } : {}),
          },
        }
      }
      if (url.startsWith('https://registry.npmjs.org/-/package/') && url.endsWith('/dist-tags')) {
        if (url.includes(encodeURIComponent('@deepseek-ai/cordis'))) {
          return {
            latest: '4.0.4',
            ...(options.cordisTag ? { [options.cordisTag.tag]: options.cordisTag.version } : {}),
          }
        }
        return { alpha: options.newerNpmVersion ?? null, next: '0.2.0-rc.2' }
      }
      if (url.startsWith('https://api.github.com/repos/deepseek-ai/deepseek-harness/tags')) {
        return [
          ...(options.newerTag ? [{ name: `dsh-v${options.newerTag}`, commit: { sha: 'b'.repeat(40) } }] : []),
          { name: 'dsh-v0.2.0-rc.2', commit: { sha: '639ed015397290b3745d163aafe02ffee4aa3f84' } },
        ]
      }
      if (url.startsWith('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases')) {
        return [
          ...(options.newerTag ? [{ tag_name: `dsh-v${options.newerTag}`, html_url: `https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v${options.newerTag}`, name: options.newerTag }] : []),
          { tag_name: 'dsh-v0.2.0-rc.2', html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2', name: 'v0.2.0-rc.2' },
        ]
      }
      const commitMatch = /commits\?path=([^&]+)&since=([^&]+)/.exec(url)
      if (commitMatch) {
        const path = decodeURIComponent(commitMatch[1] as string)
        if (options.hitPaths?.includes(path)) {
          return [{
            sha: 'e400349e3a000000000000000000000000000000',
            html_url: `https://github.com/deepseek-ai/deepseek-harness/commit/e400349e3a`,
            commit: { message: 'feat(client): touch contract', committer: { date: '2026-09-30T06:54:36Z' } },
          }]
        }
        return []
      }
      throw new Error(`unexpected fetch: ${url}`)
    },
  }
}

describe('collectSignals', () => {
  it('queries the four routes with the right endpoints and anchors commits at the base release time', async () => {
    const { fetchJson, calls } = makeFetchJson({ newerNpmVersion: '0.2.1-alpha.1', cordisTag: { tag: 'dsh-0-2-1-alpha-1', version: '4.0.5-alpha.1' } })
    const signals = await collectSignals({ watchlist: WATCHLIST, pinned: PINNED, fetchJson })

    expect(calls).toContain(urls.npmPackument('@deepseek-ai/dsh'))
    expect(calls).toContain(urls.npmDistTags('@deepseek-ai/cordis'))
    expect(calls).toContain(urls.githubTags(15))
    expect(calls).toContain(urls.githubReleases(10))
    expect(calls).toContain(urls.githubCommits('docs/subsystems/slots.md', '2026-09-14T08:00:00.000Z'))
    // One commits?path= call per whitelist entry — no clone involved.
    expect(calls.filter(url => url.includes('/commits?path=')).length).toBe(WATCHLIST.paths.length)

    expect(signals.baseVersion).toBe('0.2.0-rc.2')
    expect(signals.baseTimeIso).toBe('2026-09-14T08:00:00.000Z')
    expect(signals.npm.newerVersions).toEqual(['0.2.1-alpha.1'])
    expect(signals.npm.cordisDistTags['dsh-0-2-1-alpha-1']).toBe('4.0.5-alpha.1')
    expect(signals.github.newerTagVersions).toEqual([])
  })

  it('records whitelist hits with a commit summary carrying the upstream link', async () => {
    const { fetchJson } = makeFetchJson({
      hitPaths: ['packages/client/ui-conversation/src/client/contract/slots.ts'],
      cordisTag: { tag: 'dsh-0-2-1-alpha-1', version: '4.0.5-alpha.1' },
    })
    const signals = await collectSignals({ watchlist: WATCHLIST, pinned: PINNED, fetchJson })
    const hit = signals.whitelist.pathCommits.find(pc => pc.entry.kind === 'slot')
    expect(hit?.commits).toHaveLength(1)
    const summary = hit && hit.commits[0] && toCommitSummary(hit.commits[0])
    expect(summary?.url).toBe('https://github.com/deepseek-ai/deepseek-harness/commit/e400349e3a000000000000000000000000000000')
    expect(summary?.date).toBe('2026-09-30T06:54:36Z')
    expect(summary?.message).toBe('feat(client): touch contract')
    // The untouched paths stay in the result with zero commits (zero-hit evidence).
    expect(signals.whitelist.pathCommits.filter(pc => pc.commits.length === 0).length).toBe(2)
  })

  it('extracts newer versions from upstream dsh-v* tags', async () => {
    const { fetchJson } = makeFetchJson({ newerTag: '0.2.1-alpha.1', cordisTag: { tag: 'dsh-0-2-1-alpha-1', version: '4.0.5-alpha.1' } })
    const signals = await collectSignals({ watchlist: WATCHLIST, pinned: PINNED, fetchJson })
    expect(signals.github.newerTagVersions).toEqual(['0.2.1-alpha.1'])
  })

  it('fails loudly when the base version has no npm publish time to anchor commits', async () => {
    const broken = makeFetchJson({})
    const original = broken.fetchJson
    const fetchJson = async (url: string) => {
      const body = await original(url)
      if (url === urls.npmPackument('@deepseek-ai/dsh')) {
        return { 'dist-tags': body['dist-tags'], time: {}, versions: body.versions }
      }
      return body
    }
    await expect(collectSignals({ watchlist: WATCHLIST, pinned: PINNED, fetchJson }))
      .rejects.toThrow(/no publish time for the pinned base/)
  })
})

describe('pickTargetVersion', () => {
  function fakeSignals() {
    return {
      baseVersion: '0.2.0-rc.2',
      npm: { newerVersions: ['0.2.1-alpha.1'] },
      github: { newerTagVersions: ['0.2.1-alpha.1'] },
    }
  }

  it('prefers the explicit version and warns when it is unknown to the signals', () => {
    const notes: string[] = []
    expect(pickTargetVersion({ signals: fakeSignals(), explicitVersion: '0.2.1-alpha.1', log: m => notes.push(m) })).toBe('0.2.1-alpha.1')
    expect(notes).toHaveLength(0)
    expect(pickTargetVersion({ signals: fakeSignals(), explicitVersion: '9.9.9', log: m => notes.push(m) })).toBe('9.9.9')
    expect(notes.some(n => n.includes('not found'))).toBe(true)
  })

  it('returns the greatest newer version when nothing explicit, null when no drift', () => {
    const signals = { ...fakeSignals(), npm: { newerVersions: ['0.2.1-alpha.1', '0.2.1-alpha.2'] }, github: { newerTagVersions: [] } }
    expect(pickTargetVersion({ signals })).toBe('0.2.1-alpha.2')
    const quiet = { npm: { newerVersions: [] }, github: { newerTagVersions: [] } }
    expect(pickTargetVersion({ signals: quiet as never })).toBeNull()
  })

  it('rejects garbage explicit versions', () => {
    expect(() => pickTargetVersion({ signals: fakeSignals(), explicitVersion: 'latest' })).toThrow(/invalid --version/)
  })
})

describe('readPinnedFace', () => {
  it('reads the lockstep version and peer ranges from package.json', () => {
    const face = readPinnedFace({
      peerDependencies: { '@deepseek-ai/cordis': '*', '@deepseek-ai/dsh': '^0.2.0-rc.2' },
      devDependencies: {
        '@deepseek-ai/cordis': '4.0.4',
        '@deepseek-ai/dsh-client-locale': '0.2.0-rc.2',
        '@deepseek-ai/dsh-client-ui-slots': '0.2.0-rc.2',
        'react': '^18.2.0',
      },
    })
    expect(face.baseVersion).toBe('0.2.0-rc.2')
    expect(face.packages).toEqual(['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-slots'])
    expect(face.peerRange).toBe('^0.2.0-rc.2')
    expect(face.cordisPeerRange).toBe('*')
  })

  it('throws when the pinned devDependencies are not in lockstep', () => {
    expect(() => readPinnedFace({
      devDependencies: {
        '@deepseek-ai/dsh-client-locale': '0.2.0-rc.2',
        '@deepseek-ai/dsh-client-ui-slots': '0.2.1-alpha.1',
      },
    })).toThrow(/not in lockstep/)
  })
})

describe('parseSuiteResult', () => {
  it('parses the k:v;k:v argument into a normalized suite map', () => {
    expect(parseSuiteResult('typecheck:pass;build:pass;test-published:fail;test-fidelity:skip')).toEqual({
      provided: true,
      results: { typecheck: 'pass', build: 'pass', 'test-published': 'fail', 'test-fidelity': 'skip' },
    })
    expect(parseSuiteResult(undefined)).toEqual({ provided: false, results: {} })
  })

  it('rejects unknown keys and values', () => {
    expect(() => parseSuiteResult('lint:pass')).toThrow(/bad --suite-result/)
    expect(() => parseSuiteResult('typecheck:maybe')).toThrow(/bad --suite-result/)
  })
})
