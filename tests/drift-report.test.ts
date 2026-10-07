/**
 * Judgment + rendering for the drift watch (#59): risk/clean verdicts, the
 * hit list with upstream links, affected plugin faces, the per-version title
 * (the dedup key), and the body's acceptance checklist. All inputs are
 * synthetic — no network, no gh.
 */
import { describe, expect, it } from 'vitest'
import {
  DRIFT_LABELS,
  findExistingIssue,
  judgeSignals,
  parseSuiteResult,
  renderBody,
  renderTitle,
  urls,
  versionTitleRegex,
} from '../scripts/drift-watch.mjs'

const PINNED = {
  packages: ['@deepseek-ai/dsh-client-locale'],
  baseVersion: '0.2.0-rc.2',
  peerRange: '^0.2.0-rc.2',
  cordisPeerRange: '*',
}

const WATCHLIST = {
  paths: [
    { path: 'docs/subsystems/slots.md', kind: 'contract-doc', reason: '官方槽位契约文档', faces: ['all'] },
    { path: 'packages/client/ui-conversation/src/client/contract/slots.ts', kind: 'slot', reason: '槽位键契约', faces: ['composer-takeover', 'dock-rows'] },
    { path: 'packages/llm/token-meter/src/projection.ts', kind: 'projection', reason: 'contextPressure 投影', faces: ['context-meter'] },
  ],
}

/** Build signals shaped like collectSignals' return, with hits on demand. */
function makeSignals({ hitPaths = [] as string[], cordisTagPresent = true } = {}) {
  const commit = (path: string) => ({
    sha: `sha-${path.replaceAll('/', '-').slice(0, 20)}`.padEnd(40, '0'),
    html_url: `https://github.com/deepseek-ai/deepseek-harness/commit/sha-${path.length}`,
    commit: { message: `touch ${path}`, committer: { date: '2026-09-30T06:54:36Z' } },
  })
  return {
    baseVersion: '0.2.0-rc.2',
    baseTime: '2026-09-14T08:00:00.000Z',
    baseTimeIso: '2026-09-14T08:00:00.000Z',
    npm: {
      distTags: { alpha: '0.2.1-alpha.1', next: '0.2.0-rc.2', latest: '0.2.0-rc.2' },
      newerVersions: ['0.2.1-alpha.1'],
      packageTags: { '@deepseek-ai/dsh-client-locale': { alpha: '0.2.1-alpha.1', next: '0.2.0-rc.2' } },
      cordisDistTags: cordisTagPresent ? { 'dsh-0-2-1-alpha-1': '4.0.5-alpha.1', latest: '4.0.4' } : { latest: '4.0.4' },
    },
    github: {
      tags: [{ name: 'dsh-v0.2.1-alpha.1' }, { name: 'dsh-v0.2.0-rc.2' }],
      releases: [{ tag: 'dsh-v0.2.1-alpha.1', url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1', name: 'v0.2.1-alpha.1' }],
      newerTagVersions: ['0.2.1-alpha.1'],
    },
    whitelist: {
      pathCommits: WATCHLIST.paths.map(entry => ({
        entry,
        commits: hitPaths.includes(entry.path) ? [commit(entry.path)] : [],
      })),
      queriedSince: '2026-09-14T08:00:00.000Z',
    },
  }
}

const GREEN_SUITE = parseSuiteResult('typecheck:pass;build:pass;test-published:pass;test-fidelity:pass')

describe('judgeSignals', () => {
  it('THE #59 CASE: peer ^0.2.0-rc.2 rejecting 0.2.1-alpha.1 alone forces risk even with zero hits and a green suite', () => {
    const judgment = judgeSignals({
      signals: makeSignals(),
      watchlist: WATCHLIST,
      pinned: PINNED,
      targetVersion: '0.2.1-alpha.1',
      suite: GREEN_SUITE,
    })
    expect(judgment.verdict).toBe('risk')
    expect(judgment.semver.accepts).toBe(false)
    expect(judgment.hits).toHaveLength(0)
    expect(judgment.reasons.some(r => r.includes('拒收'))).toBe(true)
  })

  it('whitelist hits force risk and collect the affected plugin faces', () => {
    const judgment = judgeSignals({
      signals: makeSignals({ hitPaths: ['packages/client/ui-conversation/src/client/contract/slots.ts', 'docs/subsystems/slots.md'] }),
      watchlist: WATCHLIST,
      pinned: PINNED,
      targetVersion: '0.2.1-alpha.1',
      suite: GREEN_SUITE,
    })
    expect(judgment.verdict).toBe('risk')
    expect(judgment.hits.map(h => h.path)).toContain('docs/subsystems/slots.md')
    expect(judgment.contractDocHits.map(h => h.path)).toEqual(['docs/subsystems/slots.md'])
    // `all` dedupes against the concrete faces.
    expect(judgment.affectedFaces).toContain('composer-takeover')
    expect(judgment.affectedFaces).toContain('all')
  })

  it('a failed or skipped suite entry forces risk; a missing suite is never clean', () => {
    const base = { signals: makeSignals(), watchlist: WATCHLIST, pinned: PINNED, targetVersion: '0.2.1-alpha.1' }
    expect(judgeSignals({ ...base, suite: parseSuiteResult('typecheck:pass;build:pass;test-published:fail;test-fidelity:pass') }).verdict).toBe('risk')
    expect(judgeSignals({ ...base, suite: parseSuiteResult('typecheck:pass;build:pass;test-published:pass;test-fidelity:skip') }).verdict).toBe('risk')
    expect(judgeSignals({ ...base, suite: { provided: false, results: {} } }).verdict).toBe('risk')
  })

  it('the suite risk reason names the failing entries and only claims 未跑 for actually-absent keys', () => {
    const base = { signals: makeSignals(), watchlist: WATCHLIST, pinned: PINNED, targetVersion: '0.2.1-alpha.1' }
    // All four provided, two failing: the passing entries ran too — no 未跑 claim.
    const allProvided = judgeSignals({ ...base, suite: parseSuiteResult('typecheck:pass;build:pass;test-published:fail;test-fidelity:fail') })
    expect(allProvided.reasons).toContain('套件未全绿：test-published=fail、test-fidelity=fail')
    // Partially provided: the absent keys are named explicitly.
    const partial = judgeSignals({ ...base, suite: parseSuiteResult('typecheck:pass;test-fidelity:fail') })
    expect(partial.reasons).toContain('套件未全绿：test-fidelity=fail（未跑：build、test-published）')
  })

  it('zero hits + accepting peer + all-green provided suite = clean', () => {
    const judgment = judgeSignals({
      signals: makeSignals(),
      watchlist: WATCHLIST,
      pinned: PINNED,
      targetVersion: '0.2.1-alpha.1',
      // Hypothetical: a future peer bump accepts the prerelease.
      suite: GREEN_SUITE,
    })
    expect(judgment.verdict).toBe('risk') // still risk: ^0.2.0-rc.2 rejects the alpha
    const acceptingPinned = { ...PINNED, peerRange: '^0.2.1-alpha.1' }
    const clean = judgeSignals({
      signals: makeSignals(),
      watchlist: WATCHLIST,
      pinned: acceptingPinned,
      targetVersion: '0.2.1-alpha.1',
      suite: GREEN_SUITE,
    })
    expect(clean.verdict).toBe('clean')
    expect(clean.reasons).toEqual(['白名单零命中、peer 接受、四步套件全绿'])
  })

  it('a missing cordis dist-tag for the target version is its own risk reason', () => {
    const judgment = judgeSignals({
      signals: makeSignals({ cordisTagPresent: false }),
      watchlist: WATCHLIST,
      pinned: PINNED,
      targetVersion: '0.2.1-alpha.1',
      suite: GREEN_SUITE,
    })
    expect(judgment.cordis.tagPresent).toBe(false)
    expect(judgment.reasons.some(r => r.includes('cordis'))).toBe(true)
  })
})

describe('renderTitle + per-version dedup', () => {
  const base = { signals: makeSignals(), watchlist: WATCHLIST, pinned: PINNED, targetVersion: '0.2.1-alpha.1' }

  it('risk title carries the version token and the mechanical reasons', () => {
    const judgment = judgeSignals({ ...base, suite: { provided: false, results: {} } })
    const title = renderTitle(judgment)
    expect(title).toBe('[drift:risk] dsh 0.2.1-alpha.1 — peer 拒收 · 套件未跑')
    // With whitelist hits the count joins the title:
    const hitSignals = makeSignals({ hitPaths: ['docs/subsystems/slots.md'] })
    const hitJudgment = judgeSignals({ ...base, signals: hitSignals, suite: { provided: false, results: {} } })
    expect(renderTitle(hitJudgment)).toBe('[drift:risk] dsh 0.2.1-alpha.1 — peer 拒收 · 白名单 1 命中 · 套件未跑')
  })

  it('clean title for zero hits, accepted peer, green suite (hypothetical future peer)', () => {
    const judgment = judgeSignals({
      signals: makeSignals(),
      watchlist: WATCHLIST,
      pinned: { ...PINNED, peerRange: '^0.2.1-alpha.1' },
      targetVersion: '0.2.1-alpha.1',
      suite: GREEN_SUITE,
    })
    expect(renderTitle(judgment)).toBe('[drift:clean] dsh 0.2.1-alpha.1 — 套件全绿')
  })

  it('dedup regex matches its own title but not other versions (idempotency key)', () => {
    const re = versionTitleRegex('0.2.1-alpha.1')
    expect(re.test('[drift:risk] dsh 0.2.1-alpha.1 — peer 拒收')).toBe(true)
    // Not the sibling releases:
    expect(re.test('[drift:risk] dsh 0.2.1-alpha.2 — 套件全绿')).toBe(false)
    expect(re.test('[drift:clean] dsh 0.2.1 — 套件全绿')).toBe(false)
    expect(re.test('[drift:clean] dsh 0.2.10-alpha.1 — 套件全绿')).toBe(false)
    // Not ticket #59 itself, which carries the upstream-drift label but no version token:
    expect(re.test('自动化：上游漂移监视 —— 每日探测版本与契约路径，自动跑套件并开一版一票')).toBe(false)
  })

  it('findExistingIssue skips #59 and finds the same-version issue (open only)', () => {
    const openIssues = [
      { number: 59, title: '自动化：上游漂移监视 —— 每日探测版本与契约路径，自动跑套件并开一版一票' },
      { number: 70, title: '[drift:risk] dsh 0.2.1-alpha.1 — peer 拒收 · 套件未跑' },
    ]
    expect(findExistingIssue(openIssues, '0.2.1-alpha.1')?.number).toBe(70)
    expect(findExistingIssue(openIssues, '0.2.2-beta.1')).toBeNull()
    expect(findExistingIssue([], '0.2.1-alpha.1')).toBeNull()
  })

  it('labels are exactly the two pre-existing ones', () => {
    expect(DRIFT_LABELS).toEqual(['upstream-drift', 'needs-triage'])
  })
})

describe('renderBody', () => {
  const base = { signals: makeSignals({ hitPaths: ['packages/client/ui-conversation/src/client/contract/slots.ts', 'docs/subsystems/slots.md'] }), watchlist: WATCHLIST, pinned: PINNED, targetVersion: '0.2.1-alpha.1' }

  it('lists hit files with upstream blob + commit links', () => {
    const judgment = judgeSignals({ ...base, suite: { provided: false, results: {} } })
    const body = renderBody({ judgment, ...base })
    expect(body).toContain(`${urls.blobHtml('dsh-v0.2.1-alpha.1', 'packages/client/ui-conversation/src/client/contract/slots.ts')}`)
    expect(body).toContain('https://github.com/deepseek-ai/deepseek-harness/commit/sha-')
    expect(body).toContain('[dsh-v0.2.1-alpha.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)')
  })

  it('renders the mechanical judgment, semver verdict and affected faces', () => {
    const judgment = judgeSignals({ ...base, suite: { provided: false, results: {} } })
    const body = renderBody({ judgment, ...base })
    expect(body).toContain('**[drift:risk]**')
    expect(body).toContain('peer range `^0.2.0-rc.2` **拒收** `0.2.1-alpha.1`')
    expect(body).toContain('`dsh-0-2-1-alpha-1` 存在 → `4.0.5-alpha.1`')
    expect(body).toContain('输入区接管（conversation.composer 链式接管与编辑面）')
    expect(body).toContain('官方槽位契约文档')
  })

  it('renders a directly runnable real-host checklist in the retest-wizard categories', () => {
    const judgment = judgeSignals({ ...base, suite: { provided: false, results: {} } })
    const body = renderBody({ judgment, ...base })
    for (const section of ['### A. 安装与接管', '### B. 输入区行为', '### C. 附件与发送', '### D. 消息面', '### E. 抢占、视觉与文案']) {
      expect(body).toContain(section)
    }
    expect(body).toContain('node scripts/drift-watch.mjs check --version 0.2.1-alpha.1 --dry-run')
    expect(body).toContain('ISSUE_NO=<本票号> bash scripts/retest-wizard.sh')
    expect(body).toContain('outputs/retest-YYYYMMDD-0.2.1-alpha.1.md')
  })

  it('zero-hit bodies state the zero-hit evidence and the all-faces regression line', () => {
    const quiet = { ...base, signals: makeSignals() }
    const judgment = judgeSignals({ ...quiet, suite: GREEN_SUITE })
    const body = renderBody({ judgment, ...quiet })
    expect(body).toContain('零命中——基线发布以来没有任何白名单路径被改动')
    expect(body).toContain('白名单零命中时按常规全量面回归')
  })
})
