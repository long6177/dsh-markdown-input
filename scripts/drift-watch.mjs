/**
 * Upstream drift watch (issue #59): daily signals + per-version judgment +
 * one-issue-per-version reporting. ADR-0007's drift-monitoring counterpart —
 * `scripts/dev-harness.mjs` resolves the test FACE, this module decides WHEN
 * a new upstream version deserves a full-suite run and an issue.
 *
 * Layout: every decision function is pure and exported (unit-tested in
 * `tests/drift-*.test.ts` with injected fetch); only `collectSignals` and the
 * CLI touch the network (npm registry + GitHub REST) or `gh`.
 *
 * The four signal routes (handoff decision ledger, 漂移监视 row):
 * 1. npm — `@deepseek-ai/dsh` packument (versions + publish times + dist-tags)
 *    plus dist-tags for every other pinned `@deepseek-ai/*` package; cordis
 *    exposes a versioned `dsh-<ver>` dist-tag per release.
 * 2. GitHub — upstream tags (`dsh-v<version>`) and releases.
 * 3. Whitelist paths — `commits?path=` per entry (no clone needed), since the
 *    pinned base release's publish time.
 * 4. Contract docs — the two `contract-doc` entries of the whitelist.
 *
 * Judgment (mechanical, never auto-fixes code, never closes issues):
 * - `[drift:risk]` when the whitelist is hit, OR the peer range rejects the
 *   target version, OR the suite results are missing/failed/skipped.
 * - `[drift:clean]` only when the whitelist has zero hits AND the peer range
 *   accepts AND every suite entry was provided and passed.
 *
 * CLI:
 *
 * - `node scripts/drift-watch.mjs check [--version <v>] [--dry-run] [--json]
 *   [--create] [--suite-result "typecheck:pass;build:pass;test-published:pass;
 *   test-fidelity:pass"] [--run-url <url>]` — collect live signals, judge,
 *   print; `--create` opens the issue via `gh` (deduped per version by title
 *   match), `--dry-run` prints title/body and never creates anything.
 * - `node scripts/drift-watch.mjs help` — this text.
 *
 * The GitHub Actions workflow (`.github/workflows/upstream-drift.yml`) runs
 * `check --json` to pick a target version, runs the suite against that
 * version's published packages + sparse source face (same mechanics as
 * `ci.yml`), then calls back with `--suite-result` and `--create`.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

export const UPSTREAM_REPO = 'deepseek-ai/deepseek-harness'
export const UPSTREAM_HTML = `https://github.com/${UPSTREAM_REPO}`
export const NPM_REGISTRY = 'https://registry.npmjs.org'
export const DSH_PACKAGE = '@deepseek-ai/dsh'
export const CORDIS_PACKAGE = '@deepseek-ai/cordis'
/** Labels every drift issue carries (both pre-exist; see docs/agents/triage-labels.md). */
export const DRIFT_LABELS = ['upstream-drift', 'needs-triage']

// ────────────────────────────────────────────────────────────────────────────
// Semver subset: exactly what the peer ranges in package.json need.
// Supports `*`, exact `X.Y.Z[-pre]`, and caret `^X.Y.Z[-pre]` — no OR ranges,
// no x-ranges. Implements semver precedence including the prerelease
// same-tuple exclusion rule (a prerelease satisfies a range only when some
// comparator carries a prerelease on the SAME [major,minor,patch] tuple).
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a semver version into its parts.
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[] | null, raw: string } | null}
 *   `prerelease` is `null` for a release, else the dot-split identifiers.
 */
export function parseVersion(version) {
  if (typeof version !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim())
  if (!match) return null
  const [, major, minor, patch, pre] = /** @type {RegExpExecArray & { [k: number]: string }} */ (match)
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: pre === undefined ? null : pre.split('.'),
    raw: version.trim().replace(/^v/, ''),
  }
}

/**
 * Compare two prerelease identifier lists per semver rule 11 (numeric
 * identifiers compare numerically and rank below alphanumeric ones; a longer
 * list outranks a prefix of itself; absent prerelease outranks any).
 */
function comparePrerelease(a, b) {
  if (a === null || a.length === 0) return b === null || b.length === 0 ? 0 : 1
  if (b === null || b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1 // a is a proper prefix of b → a is smaller (rule 11.4)
    if (right === undefined) return 1
    const ln = /^\d+$/.test(left)
    const rn = /^\d+$/.test(right)
    if (ln && rn) {
      const diff = Number(left) - Number(right)
      if (diff !== 0) return diff < 0 ? -1 : 1
    } else if (ln !== rn) {
      return ln ? -1 : 1 // numeric < alphanumeric
    } else if (left !== right) {
      return left < right ? -1 : 1
    }
  }
  return 0
}

/**
 * Full semver precedence comparison of two version strings.
 * @returns {number} negative when a < b, 0 when equal, positive when a > b.
 */
export function compareVersions(a, b) {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (!va || !vb) throw new Error(`invalid version: ${!va ? a : b}`)
  for (const key of ['major', 'minor', 'patch']) {
    if (va[key] !== vb[key]) return va[key] - vb[key]
  }
  return comparePrerelease(va.prerelease, vb.prerelease)
}

/**
 * Whether `range` accepts `version` (semver subset: `*`, exact, caret).
 * The prerelease same-tuple rule decides the #59 acceptance case:
 * `^0.2.0-rc.2` does NOT accept `0.2.1-alpha.1`.
 * @param {string} range
 * @param {string} version
 * @returns {boolean}
 */
export function rangeAccepts(range, version) {
  const v = parseVersion(version)
  if (!v) throw new Error(`invalid version: ${version}`)
  const text = range.trim()
  if (text === '*' || text === '') return v.prerelease === null
  const caret = /^\^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text)
  const exact = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text)
  if (!caret && !exact) throw new Error(`unsupported peer range (drift-watch supports *, exact, ^): ${range}`)
  const [, major, minor, patch, pre] = caret ?? exact
  const lower = parseVersion(`${major}.${minor}.${patch}${pre ? `-${pre}` : ''}`)
  // An exact range means exactly that version — prerelease and all.
  if (!caret) return compareVersions(v.raw, lower.raw) === 0
  // Lower bound is inclusive and carries a prerelease, so the same-tuple rule
  // never excludes it; the upper bound is a plain release ceiling.
  if (compareVersions(v.raw, lower.raw) < 0) return false
  let upper
  if (Number(major) > 0) {
    upper = parseVersion(`${Number(major) + 1}.0.0`)
  } else if (Number(minor) > 0) {
    upper = parseVersion(`0.${Number(minor) + 1}.0`)
  } else {
    upper = parseVersion(`0.0.${Number(patch) + 1}`)
  }
  if (compareVersions(v.raw, upper.raw) >= 0) return false
  // Prerelease exclusion: a prerelease version satisfies the range only when
  // the lower comparator carries a prerelease on the same [maj,min,patch].
  if (v.prerelease !== null) {
    const sameTuple = v.major === lower.major && v.minor === lower.minor && v.patch === lower.patch
    return sameTuple
  }
  return true
}

/**
 * The cordis dist-tag that tracks one dsh version: dots become dashes
 * (`0.2.1-alpha.1` → `dsh-0-2-1-alpha-1` → npm resolves `4.0.5-alpha.1`).
 * @param {string} version
 */
export function cordisTagFor(version) {
  return `dsh-${version.replaceAll('.', '-')}`
}

// ────────────────────────────────────────────────────────────────────────────
// Pinned face + watchlist loading.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Read the pinned upstream face and peer ranges out of this repo's
 * package.json — the single source of truth for "which upstream version are
 * we tested against" (ADR-0007 devDependencies) and "which versions do we
 * accept" (peerDependencies).
 * @param {object} packageJson parsed package.json contents.
 */
export function readPinnedFace(packageJson) {
  const devDeps = packageJson.devDependencies ?? {}
  const packages = Object.keys(devDeps)
    .filter(name => name.startsWith('@deepseek-ai/') && name !== CORDIS_PACKAGE)
    .sort()
  const versions = new Set(packages.map(name => devDeps[name]))
  if (versions.size > 1) {
    throw new Error(`pinned @deepseek-ai/* devDependencies are not in lockstep: ${[...versions].join(', ')}`)
  }
  const baseVersion = devDeps[packages[0] ?? '']
  if (!baseVersion) throw new Error('no pinned @deepseek-ai/* devDependencies found in package.json')
  const peers = packageJson.peerDependencies ?? {}
  return {
    /** Every pinned upstream package except cordis (the lockstep set). */
    packages,
    /** The pinned upstream version (npm exact version, no range). */
    baseVersion,
    /** Peer range declared for `@deepseek-ai/dsh`. */
    peerRange: peers[DSH_PACKAGE] ?? '*',
    /** Peer range declared for `@deepseek-ai/cordis` (currently `*`). */
    cordisPeerRange: peers[CORDIS_PACKAGE] ?? '*',
  }
}

/** Read and parse the whitelist (`scripts/drift-watchlist.json` by default). */
export function loadWatchlist(path = join(REPO_ROOT, 'scripts', 'drift-watchlist.json')) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// ────────────────────────────────────────────────────────────────────────────
// Signals: pure orchestration over an injected `fetchJson`.
// ────────────────────────────────────────────────────────────────────────────

/** URL builders, exported so tests can assert the exact endpoints. */
export const urls = {
  npmPackument: pkg => `${NPM_REGISTRY}/${encodeURIComponent(pkg)}`,
  npmDistTags: pkg => `${NPM_REGISTRY}/-/package/${encodeURIComponent(pkg)}/dist-tags`,
  githubTags: perPage => `https://api.github.com/repos/${UPSTREAM_REPO}/tags?per_page=${perPage}`,
  githubReleases: perPage => `https://api.github.com/repos/${UPSTREAM_REPO}/releases?per_page=${perPage}`,
  githubCommits: (path, sinceIso, perPage = 10) =>
    `https://api.github.com/repos/${UPSTREAM_REPO}/commits?path=${encodeURIComponent(path)}`
      + `&since=${encodeURIComponent(sinceIso)}&per_page=${perPage}`,
  commitHtml: sha => `${UPSTREAM_HTML}/commit/${sha}`,
  blobHtml: (ref, path) => `${UPSTREAM_HTML}/blob/${ref}/${path}`,
}

/** Latest commit fields the whitelist hit list needs, from a REST commit object. */
export function toCommitSummary(commit) {
  const date = commit?.commit?.committer?.date ?? commit?.commit?.author?.date ?? null
  return {
    sha: commit?.sha ?? null,
    date,
    message: (commit?.commit?.message ?? '').split('\n')[0] ?? '',
    url: commit?.sha ? urls.commitHtml(commit.sha) : null,
  }
}

/** Versions mentioned by upstream git tags (`dsh-v<version>` shape). */
export function versionsFromTags(tags) {
  const out = []
  for (const tag of tags ?? []) {
    const match = /^dsh-v(.+)$/.exec(tag?.name ?? '')
    if (match && parseVersion(match[1])) out.push(match[1])
  }
  return out
}

/**
 * Collect the four signal routes. Pure orchestration: `fetchJson(url)` is
 * injected (tests use a stub; the CLI wires global fetch + optional token).
 * @param {object} options
 * @param {Array<{ path: string, kind: string, reason: string, faces: string[] }>} options.watchlist
 * @param {ReturnType<typeof readPinnedFace>} options.pinned
 * @param {(url: string) => Promise<any>} options.fetchJson
 * @param {(line: string) => void} [options.log]
 */
export async function collectSignals({ watchlist, pinned, fetchJson, log = () => {} }) {
  // Route 1a: the dsh packument — versions, publish times, dist-tags.
  log(`npm: packument ${DSH_PACKAGE}`)
  const packument = await fetchJson(urls.npmPackument(DSH_PACKAGE))
  const npmDistTags = packument?.['dist-tags'] ?? {}
  const npmTime = packument?.time ?? {}
  const baseTime = npmTime[pinned.baseVersion]
  if (!baseTime) {
    throw new Error(`npm packument has no publish time for the pinned base ${pinned.baseVersion} — cannot anchor whitelist commits`)
  }
  const newerNpmVersions = Object.keys(packument?.versions ?? {})
    .filter(version => parseVersion(version) && compareVersions(version, pinned.baseVersion) > 0)
    .sort(compareVersions)

  // Route 1b: dist-tags for the rest of the lockstep set + cordis.
  const packageTags = {}
  for (const pkg of pinned.packages) {
    log(`npm: dist-tags ${pkg}`)
    packageTags[pkg] = await fetchJson(urls.npmDistTags(pkg))
  }
  log(`npm: dist-tags ${CORDIS_PACKAGE}`)
  const cordisDistTags = await fetchJson(urls.npmDistTags(CORDIS_PACKAGE))

  // Route 2: upstream tags + releases.
  log('github: tags + releases')
  const [tags, releases] = await Promise.all([
    fetchJson(urls.githubTags(15)),
    fetchJson(urls.githubReleases(10)),
  ])
  const newerTagVersions = versionsFromTags(tags).filter(v => compareVersions(v, pinned.baseVersion) > 0)

  // Routes 3+4: whitelist path commits since the base release time. The two
  // contract docs are whitelist entries of kind `contract-doc` — probed the
  // same way, reported under their own heading.
  const baseTimeIso = new Date(baseTime).toISOString()
  /** @type {Array<{ entry: any, commits: any[] }>} */
  const pathCommits = []
  for (const entry of watchlist.paths) {
    log(`whitelist: ${entry.path}`)
    const commits = await fetchJson(urls.githubCommits(entry.path, baseTimeIso))
    pathCommits.push({ entry, commits: Array.isArray(commits) ? commits : [] })
  }

  return {
    baseVersion: pinned.baseVersion,
    baseTime,
    baseTimeIso,
    npm: { distTags: npmDistTags, newerVersions: newerNpmVersions, packageTags, cordisDistTags },
    github: {
      tags: (tags ?? []).map(t => ({ name: t?.name ?? '', url: `${UPSTREAM_HTML}/releases/tag/${t?.name ?? ''}` })),
      releases: (releases ?? []).map(r => ({ tag: r?.tag_name ?? '', url: r?.html_url ?? '', name: r?.name ?? '' })),
      newerTagVersions,
    },
    whitelist: { pathCommits, queriedSince: baseTimeIso },
  }
}

/**
 * Pick the target version to judge: the explicit `--version`, or the greatest
 * version newer than the base across npm + git tags. Returns `null` when
 * nothing newer exists (no drift, no issue).
 */
export function pickTargetVersion({ signals, explicitVersion, log = () => {} }) {
  if (explicitVersion) {
    if (!parseVersion(explicitVersion)) throw new Error(`invalid --version: ${explicitVersion}`)
    const known = signals.npm.newerVersions.includes(explicitVersion)
      || signals.github.newerTagVersions.includes(explicitVersion)
    if (!known) log(`note: ${explicitVersion} was not found in the collected npm/tag signals (dispatching for an unreleased or very fresh version?)`)
    return explicitVersion
  }
  const candidates = [...new Set([...signals.npm.newerVersions, ...signals.github.newerTagVersions])]
  if (candidates.length === 0) return null
  const target = candidates.sort(compareVersions).at(-1)
  log(`new upstream versions since ${signals.baseVersion}: ${candidates.join(', ')} — target ${target}`)
  return target
}

// ────────────────────────────────────────────────────────────────────────────
// Judgment + rendering (pure).
// ────────────────────────────────────────────────────────────────────────────

export const SUITE_KEYS = ['typecheck', 'build', 'test-published', 'test-fidelity']

/**
 * Parse the `--suite-result "key:pass;build:fail"` argument into a normalized
 * suite map. Unknown keys throw; missing keys stay absent (→ "not provided").
 */
export function parseSuiteResult(text) {
  if (!text) return { provided: false, results: {} }
  const results = {}
  for (const part of text.split(';').map(s => s.trim()).filter(Boolean)) {
    const [key, value] = part.split(':').map(s => s?.trim())
    if (!SUITE_KEYS.includes(key) || !['pass', 'fail', 'skip'].includes(value)) {
      throw new Error(`bad --suite-result entry "${part}" (expected key ${SUITE_KEYS.join('/')} = pass/fail/skip)`)
    }
    results[key] = value
  }
  return { provided: Object.keys(results).length > 0, results }
}

/**
 * Mechanical judgment for one target version.
 * @param {object} options
 * @param {ReturnType<typeof collectSignals>} options.signals
 * @param {Array<{ path: string, kind: string, reason: string, faces: string[] }>} options.watchlist
 * @param {ReturnType<typeof readPinnedFace>} options.pinned
 * @param {string} options.targetVersion
 * @param {{ provided: boolean, results: Record<string, 'pass'|'fail'|'skip'> }} options.suite
 */
export function judgeSignals({ signals, watchlist, pinned, targetVersion, suite }) {
  // Whitelist hits: entries with ≥1 commit since the base release time.
  const hits = signals.whitelist.pathCommits
    .filter(({ commits }) => commits.length > 0)
    .map(({ entry, commits }) => ({
      path: entry.path,
      kind: entry.kind,
      reason: entry.reason,
      faces: entry.faces,
      count: commits.length,
      latest: toCommitSummary(commits[0]),
    }))
  const contractDocHits = hits.filter(hit => hit.kind === 'contract-doc')
  const affectedFaces = [...new Set(hits.flatMap(hit => hit.faces))]

  const semverCheck = {
    pkg: DSH_PACKAGE,
    range: pinned.peerRange,
    version: targetVersion,
    accepts: rangeAccepts(pinned.peerRange, targetVersion),
  }
  // cordis rides a versioned dist-tag per dsh version (ADR-0007); its peer
  // range is `*` and pins nothing, so the mechanical check is tag presence
  // and the mapped cordis version — no semver claim about a dsh version.
  const cordisMapped = signals.npm.cordisDistTags?.[cordisTagFor(targetVersion)] ?? null
  const cordisCheck = {
    pkg: CORDIS_PACKAGE,
    distTag: cordisTagFor(targetVersion),
    tagPresent: cordisMapped !== null,
    version: cordisMapped,
  }

  const reasons = []
  if (hits.length > 0) {
    reasons.push(`白名单命中 ${hits.length} 条（含契约文档 ${contractDocHits.length} 份）`)
  }
  if (!semverCheck.accepts) {
    reasons.push(`peer range ${semverCheck.range} 按 semver 拒收 ${targetVersion}（预发布同元组规则）`)
  }
  if (!cordisCheck.tagPresent) {
    reasons.push(`cordis 缺少版本化 dist-tag ${cordisCheck.distTag}`)
  }
  const suiteValues = Object.values(suite.results)
  const allPass = suite.provided && SUITE_KEYS.every(key => suite.results[key] === 'pass')
  if (!suite.provided) {
    reasons.push('套件结果未提供（该版本未跑全套测试）')
  } else if (!allPass) {
    const bad = SUITE_KEYS.filter(key => suite.results[key] && suite.results[key] !== 'pass')
    const missing = SUITE_KEYS.filter(key => !suite.results[key])
    reasons.push(`套件未全绿：${bad.map(key => `${key}=${suite.results[key]}`).join('、')}${missing.length > 0 ? `（未跑：${missing.join('、')}）` : ''}`)
  }

  const verdict = reasons.length === 0 ? 'clean' : 'risk'
  if (verdict === 'clean') reasons.push('白名单零命中、peer 接受、四步套件全绿')

  return {
    verdict,
    reasons,
    hits,
    contractDocHits,
    affectedFaces,
    semver: semverCheck,
    cordis: cordisCheck,
    suite: { ...suite, allPass },
  }
}

/** The stable per-version token every drift title carries — the dedup key. */
export function titleVersionToken(version) {
  return `dsh ${version}`
}

/**
 * `[drift:risk] dsh 0.2.1-alpha.1 — peer 拒收 · 白名单 3 命中 · 套件未跑`
 * The version token is fixed-position so per-version dedup is a plain regex.
 */
export function renderTitle(judgment) {
  const parts = []
  if (!judgment.semver.accepts) parts.push('peer 拒收')
  if (judgment.hits.length > 0) parts.push(`白名单 ${judgment.hits.length} 命中`)
  if (!judgment.suite.provided) parts.push('套件未跑')
  else if (!judgment.suite.allPass) {
    const bad = SUITE_KEYS.filter(key => judgment.suite.results[key] && judgment.suite.results[key] !== 'pass')
    parts.push(`套件 ${SUITE_KEYS.length - bad.length}/${SUITE_KEYS.length} 绿`)
  } else parts.push('套件全绿')
  const suffix = parts.length > 0 ? ` — ${parts.join(' · ')}` : ''
  return `[drift:${judgment.verdict}] ${titleVersionToken(judgment.semver.version)}${suffix}`
}

/**
 * Regex matching an existing drift issue title for one version. The trailing
 * guard keeps `0.2.1` from matching `0.2.1-alpha.1` and vice versa.
 */
export function versionTitleRegex(version) {
  const escaped = version.replaceAll('.', '\\.').replaceAll('-', '\\-')
  return new RegExp(`dsh ${escaped}(?![\\w.-])`)
}

/** One issue per version: match `title` against the open upstream-drift issues. */
export function findExistingIssue(issues, version) {
  const re = versionTitleRegex(version)
  return (issues ?? []).find(issue => re.test(issue.title ?? '')) ?? null
}

const FACE_LABELS = {
  'composer-takeover': '输入区接管（conversation.composer 链式接管与编辑面）',
  'dock-rows': 'composer.dock 行（context meter、接管工具行）',
  'user-markdown': '用户消息 Markdown 化（chat.node user 键）',
  'steering-bubbles': '排队 steering 气泡（chat.node steering 键）',
  'context-meter': '上下文压力/占用投影（contextPressure/breakdown/tokenUsage）',
  'stats-pills': '会话统计药丸（sessionStats）',
  'chat-seats': '消息座位替换（copy/clock chrome）',
  'remote-verbs': 'remote 命名空间调用（goals/commands/skills/…）',
  'event-listeners': '事件监听（5 个 catalog/change/reset 事件）',
  'css-tokens': 'CSS token 对齐（--dsw-* / .dock 宿主类）',
  'capability-probes': '能力探测与降级（primitives 符号、remote presence）',
  'locale-dicts': 'locale 词典注册与快照',
  'all': '全部插件面',
}

function faceLabel(face) {
  return FACE_LABELS[face] ?? face
}

/** The real-host checklist, grouped like `scripts/retest-wizard.sh`'s stages. */
export function renderChecklist(targetVersion) {
  return [
    '## 真机验收 checklist（可直接照跑）',
    '',
    '> 分类对齐 `scripts/retest-wizard.sh` 的阶段划分（可 `ISSUE_NO=<本票号> bash scripts/retest-wizard.sh` 逐项记录并评论回本票）；',
    '> 结果记 `outputs/retest-YYYYMMDD-' + targetVersion + '.md`（`outputs/` 不入库），风格同 `docs/agents/release.md` 第 6 步「真机重测」。',
    '',
    '### A. 安装与接管（retest 阶段 1）',
    '',
    '- [ ] `npm i -g @deepseek-ai/dsh@' + targetVersion + '`（或用现有全局 dsh，但插件面测试针对该版本宿主）',
    '- [ ] `pnpm build` 后 `dsh plugin --profile web add link:<本仓绝对路径>`，`dsh web` 启动',
    '- [ ] 输入区被接管：出现「渲染」按钮与等宽编辑面（未接管先查 `cordis_inspect what:"client"`）',
    '',
    '### B. 输入区行为（retest 阶段 2–5）',
    '',
    '- [ ] 渲染模式折叠：`#` 标题折叠/恢复、`- [ ]` 任务项出现复选框',
    '- [ ] 源码/渲染切换，F5 后模式持久化',
    '- [ ] 键位：Enter 发送、Shift+Enter 换行、``` 围栏内不发送、中文 IME 候选 Enter 不误发',
    '- [ ] 富文本粘贴转干净 Markdown；Ctrl+Shift+V 纯文本直贴',
    '',
    '### C. 附件与发送（retest 阶段 6–8）',
    '',
    '- [ ] 附件栏：缩略图/文件 chip/× 删除/拖放入口',
    '- [ ] 上传中扣住发送、失败 chip 与重试',
    '- [ ] 断网发送：错误横幅出现在接管卡片上（约 6s 消散）',
    '',
    '### D. 消息面（retest 阶段 9–11）',
    '',
    '- [ ] 用户消息气泡按 Markdown 渲染（# / **粗体** / - 列表）',
    '- [ ] 排队 steering 气泡按 Markdown 渲染（判定对象是吸收后的正式气泡）',
    '- [ ] 引用 chip（@提及 / /技能 / 会话引用）在渲染结果中保留',
    '',
    '### E. 抢占、视觉与文案（retest 阶段 12–13）',
    '',
    '- [ ] 内置面板抢占后输入区恢复且草稿幸存',
    '- [ ] 圆角/菜单 backdrop/焦点环与宿主观感一致（对照判定摘要里的 CSS token 命中）',
    '- [ ] 界面切 English：按钮/占位文案随语言切换（对照 locale 快照）',
    '',
    '汇总规则同 retest wizard：PASS/FAIL/SKIP 计数写进报告；FAIL 项逐条开票，不与本票混记。',
  ].join('\n')
}

/**
 * The full issue body: judgment summary, signals, hit list with upstream
 * links, affected faces, suite results, semver verdict, checklist, repro.
 */
export function renderBody({ judgment, signals, targetVersion, runUrl }) {
  const ref = `dsh-v${targetVersion}`
  const lines = []
  lines.push(`> 自动判定：**[${judgment.verdict === 'clean' ? 'drift:clean' : 'drift:risk'}]** · 目标版本 \`${targetVersion}\` · 锚定基线 \`${signals.baseVersion}\`（发布于 ${signals.baseTimeIso.slice(0, 10)}）`)
  if (runUrl) lines.push(`> 运行：${runUrl}`)
  lines.push('')

  lines.push('## 自动判定摘要')
  lines.push('')
  for (const reason of judgment.reasons) lines.push(`- ${reason}`)
  lines.push('')

  lines.push('## 版本信号')
  lines.push('')
  lines.push(`- npm \`${DSH_PACKAGE}\` dist-tags：${Object.entries(signals.npm.distTags).map(([tag, ver]) => `${tag}=\`${ver}\``).join('、')}`)
  const otherTags = Object.entries(signals.npm.packageTags)
    .filter(([, tags]) => tags && Object.keys(tags).length > 0)
  const alphaSet = otherTags.filter(([, tags]) => tags.alpha).map(([pkg, tags]) => `${pkg.replace('@deepseek-ai/dsh-', '')}=\`${tags.alpha}\``)
  if (alphaSet.length > 0) lines.push(`- 锁步包 \`alpha\` tag：${alphaSet.join('、')}`)
  lines.push(`- cordis dist-tag \`${judgment.cordis.distTag}\`：${judgment.cordis.tagPresent ? `存在 → \`${judgment.cordis.version}\`` : '**缺失**'}`)
  const release = signals.github.releases.find(r => r.tag === ref)
  lines.push(`- GitHub Release/Tag：${release ? `[${release.tag}](${release.url})` : `tag [\`${ref}\`](${UPSTREAM_HTML}/releases/tag/${ref})`}${signals.github.newerTagVersions.length > 0 ? `（基线后的 tag 版本：${signals.github.newerTagVersions.join('、')}）` : ''}`)
  lines.push('')

  lines.push('## semver 检查')
  lines.push('')
  lines.push(`- \`${judgment.semver.pkg}\`: peer range \`${judgment.semver.range}\` ${judgment.semver.accepts ? '**接受**' : '**拒收**'} \`${targetVersion}\`` + (judgment.semver.accepts ? '' : '（semver 预发布同元组规则：范围上的预发布下界只接受同 [major,minor,patch] 的预发布版本）'))
  lines.push(`- \`${judgment.cordis.pkg}\`: dist-tag \`${judgment.cordis.distTag}\` ${judgment.cordis.tagPresent ? `存在 → \`${judgment.cordis.version}\`` : '**缺失**'}（peer \`*\` 不锁 cordis 版本，实际对应关系走版本化 dist-tag，见 ADR-0007）`)
  lines.push('')

  lines.push('## 套件结果')
  lines.push('')
  if (!judgment.suite.provided) {
    lines.push('未提供——该版本尚未用「发布包 + 该 ref sparse 源码」跑全套（机制见 `.github/workflows/upstream-drift.yml`，本地可用 `--suite-result` 补记）。')
  } else {
    for (const key of SUITE_KEYS) {
      const value = judgment.suite.results[key]
      lines.push(`- ${key}: ${value ? (value === 'pass' ? '**pass**' : value === 'fail' ? '**fail**' : 'skip') : '未跑'}`)
    }
  }
  lines.push('')

  lines.push(`## 白名单命中（${judgment.hits.length} 条，探测起点 ${signals.whitelist.queriedSince.slice(0, 10)}）`)
  lines.push('')
  if (judgment.hits.length === 0) {
    lines.push('零命中——基线发布以来没有任何白名单路径被改动。')
  } else {
    judgment.hits.forEach((hit, index) => {
      const blob = urls.blobHtml(ref, hit.path)
      const commitLink = hit.latest.url
        ? `[${hit.latest.sha.slice(0, 10)}](${hit.latest.url})（${hit.latest.date?.slice(0, 10) ?? ''}）`
        : '(无链接)'
      lines.push(`${index + 1}. [\`${hit.path}\`](${blob}) — kind \`${hit.kind}\`，最新提交 ${commitLink}`)
      lines.push(`   关注理由：${hit.reason}`)
      lines.push(`   关联插件面：${hit.faces.map(faceLabel).join('；')}`)
    })
  }
  lines.push('')

  lines.push('## 疑似受影响的插件面')
  lines.push('')
  lines.push(judgment.affectedFaces.length > 0
    ? judgment.affectedFaces.map(faceLabel).map(label => `- ${label}`).join('\n')
    : '- 白名单零命中时按常规全量面回归（checklist 如下）')
  lines.push('')

  lines.push(renderChecklist(targetVersion))
  lines.push('')

  lines.push('## 复现')
  lines.push('')
  lines.push('```bash')
  lines.push(`# 判定预演（不开票）：`)
  lines.push(`node scripts/drift-watch.mjs check --version ${targetVersion} --dry-run`)
  lines.push('```')
  lines.push('')
  lines.push('本票由 `.github/workflows/upstream-drift.yml`（每日 schedule / 手动 dispatch）或同款 CLI 调用产生；工作流不自动改代码、不自动关票，修复优先级由维护者决定。')
  lines.push('')
  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// CLI plumbing (thin): fetch wiring, gh calls, arg parsing.
// ────────────────────────────────────────────────────────────────────────────

/** Build the injected `fetchJson` used by the CLI: npm + GitHub REST with an optional token. */
export function makeFetchJson({ token, log = () => {} } = {}) {
  return async function fetchJson(url) {
    const isGithub = url.startsWith('https://api.github.com/')
    const headers = { 'user-agent': 'dsh-markdown-input-drift-watch' }
    // npm rejects the GitHub accept header with 406; keep them per-host.
    if (isGithub) {
      headers.accept = 'application/vnd.github+json'
      if (token) headers.authorization = `Bearer ${token}`
    }
    const response = await fetch(url, { headers })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} for ${url}`)
    }
    const body = await response.json()
    log(`fetched ${url} (${JSON.stringify(body).length} bytes)`)
    return body
  }
}

/** Run gh synchronously, capture stdout. Throws with stderr on failure. */
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function printHelp() {
  console.log(`usage: node scripts/drift-watch.mjs check [options]

options:
  --version <v>       judge this explicit upstream version (else: newest newer)
  --dry-run           print verdict/title/body, never create or list issues
  --create            actually create the issue via gh (deduped per version)
  --json              machine-readable summary on stdout
  --suite-result <s>  "typecheck:pass;build:pass;test-published:pass;test-fidelity:pass"
  --run-url <url>     link to the driving Actions run (goes into the body)
  --watchlist <path>  alternate whitelist file (default scripts/drift-watchlist.json)
  help                this text`)
}

/** Parse CLI args into a map; `--flag value` pairs plus bare booleans. */
export function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next
        i += 1
      } else {
        args[key] = true
      }
    } else {
      args._.push(arg)
    }
  }
  return args
}

async function cmdCheck(args) {
  const dryRun = args['dry-run'] === true
  const create = args.create === true
  if (dryRun && create) throw new Error('--dry-run and --create are mutually exclusive')
  const watchlist = loadWatchlist(args.watchlist)
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  const pinned = readPinnedFace(packageJson)
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || undefined
  const fetchJson = makeFetchJson({ token })
  const log = args.json ? () => {} : line => console.error(`[drift] ${line}`)

  const signals = await collectSignals({ watchlist, pinned, fetchJson, log })
  const targetVersion = pickTargetVersion({ signals, explicitVersion: args.version, log })
  const suite = parseSuiteResult(args['suite-result'])

  if (!targetVersion) {
    const summary = { targetVersion: null, hasNew: false, verdict: null, message: `no upstream version newer than ${pinned.baseVersion} — nothing to do` }
    console.log(JSON.stringify(summary, null, 2))
    if (!args.json) console.log(`no drift: nothing newer than ${pinned.baseVersion}`)
    return 0
  }

  const judgment = judgeSignals({ signals, watchlist, pinned, targetVersion, suite })
  const title = renderTitle(judgment)
  const body = renderBody({ judgment, signals, targetVersion, runUrl: typeof args['run-url'] === 'string' ? args['run-url'] : undefined })

  if (args.json) {
    console.log(JSON.stringify({
      targetVersion,
      hasNew: true,
      verdict: judgment.verdict,
      reasons: judgment.reasons,
      hits: judgment.hits,
      affectedFaces: judgment.affectedFaces,
      semver: judgment.semver,
      cordis: { distTag: judgment.cordis.distTag, tagPresent: judgment.cordis.tagPresent, version: judgment.cordis.version },
      suite: judgment.suite,
      title,
      labels: DRIFT_LABELS,
      // For the workflow's suite step: what to override to the target version.
      pinnedVersion: pinned.baseVersion,
      packages: pinned.packages,
      cordisDistTag: judgment.cordis.distTag,
    }, null, 2))
  } else {
    console.log(`verdict: ${judgment.verdict}`)
    for (const reason of judgment.reasons) console.log(`  - ${reason}`)
    console.log(`title: ${title}`)
    if (dryRun) console.log('--- body ---')
  }
  if (dryRun) {
    console.log(body)
    return 0
  }
  if (!create) return 0

  // Real creation path: dedup against open upstream-drift issues by title.
  const openIssues = JSON.parse(gh(['issue', 'list', '--label', 'upstream-drift', '--state', 'open', '--json', 'number,title']))
  const existing = findExistingIssue(openIssues, targetVersion)
  if (existing) {
    console.log(`issue for ${targetVersion} already exists: #${existing.number} ${existing.title} — not creating a second one`)
    console.log(String(existing.number))
    return 0
  }
  const tmp = mkdtempSync(join(tmpdir(), 'drift-'))
  const bodyFile = join(tmp, 'body.md')
  writeFileSync(bodyFile, body, 'utf8')
  try {
    const createArgs = ['issue', 'create', '--title', title, '--body-file', bodyFile]
    for (const label of DRIFT_LABELS) createArgs.push('--label', label)
    const url = gh(createArgs).trim()
    console.log(url)
    return 0
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main(argv) {
  const [command, ...rest] = argv
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return 0
  }
  if (command === 'check') return cmdCheck(parseArgs(rest))
  console.error(`unknown command "${command}" — expected check | help`)
  return 2
}

const invokedDirectly = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2))
