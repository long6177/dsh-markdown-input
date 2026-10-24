/**
 * Pure decision core of the typed-trigger completion popups (T10): the `/`
 * trigger (command + skill candidate groups) and the `@` trigger (file/folder
 * search candidates). Zero React / DOM / CodeMirror — the editor surface
 * calls `detectCompletion` per update and the popup face consumes
 * `assembleCompletionView` for one render.
 *
 * Grammar mirrors the host's trigger pipeline (`ui-input-trigger/src/core/
 * detect.ts` + `dsh-file-reference/grammar`, both not exported to plugins —
 * re-declared structurally like every host shape in this plugin):
 * - `@` first, per the shared grammar: an open quoted token (`@"…` up to the
 *   caret, whitespace inside) wins over a bare non-space run; an `@` inside
 *   another token (an email address) is no trigger;
 * - then `/`, scanning backwards to the first whitespace with the
 *   word-boundary rules — no trigger after a word character, and the two URL
 *   carve-outs (`//` and `://`) keep slashes dead inside URLs;
 * - a token is `leading` when only whitespace precedes it (the host's
 *   `draft.search(/\S/) === span.start`), which is what filters claim rows
 *   inline (host position filter, T5 parity).
 *
 * Candidate assembly mirrors the native MenuView data flow: the empty-slash
 * query shows the T5 menu's sectioned rows (the `+` button is the same
 * command source at `query: ''`), a non-empty query runs both groups through
 * `rankByName` (prefix hits first, name+label keys, case-insensitive ordered
 * subsequence — imported from the seed ui-primitives, the host's own rank),
 * and `@` results project through `formatFileMention` so the inserted text is
 * exactly the wire form the host's reference pipeline writes (quoted for
 * whitespace, open quote on a drilled directory, unrepresentable paths
 * dropped). Stale-while-revalidate is a data shape here: a pending group
 * keeps its previous results visible while the fresh fetch runs.
 */
import { rankByName, relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { CommandMenuRow } from './command-rows.ts'
import type { SkillEntry } from './skill-face.ts'
import type { SessionMentionCandidate } from './session-reference-face.ts'
import type { SessionSummaryLike } from './sessions-face.ts'
import type { ComposerKey } from './locales.ts'

/** The two trigger characters the popups track. */
export type CompletionTrigger = '/' | '@'

/** Whether only whitespace precedes the token (the host trigger position). */
export type CompletionPosition = 'leading' | 'inline'

/**
 * Input-phase guard tier (host TriggerGuard): `plain` arms both triggers,
 * `claimed` (a command claim holds the draft) suppresses `/` while `@` stays
 * live, `frozen` (adjudicating/submitting) suppresses both.
 */
export type CompletionGuard = 'plain' | 'claimed' | 'frozen'

/** One live trigger token ending at the caret, in document coordinates. */
export interface CompletionProbe {
  readonly trigger: CompletionTrigger
  /** Text after the trigger character (path text for a quoted `@"`). */
  readonly query: string
  /** The user opened a quoted path (`@"…`). */
  readonly quoted: boolean
  readonly position: CompletionPosition
  /** Token span: trigger index .. caret. */
  readonly start: number
  readonly end: number
}

const WHITESPACE_RE = /\s/u
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u

/**
 * One file/folder candidate of the host `remote.fileReferences` namespace
 * (`dsh-file-reference` types, re-declared structurally).
 */
export interface FileReferenceCandidate {
  /** Workspace-relative path accepted by prompts and filesystem tools. */
  readonly path: string
  readonly kind: 'file' | 'directory'
}

/**
 * What may follow a trigger token scan: the `@` grammar runs on the text
 * before the caret (`dsh-file-reference/grammar` activeAtToken, whole-draft
 * form — `\n` is whitespace, so line starts need no special case).
 */
function activeAtToken(beforeCursor: string): { prefix: string, query: string, quoted: boolean } | undefined {
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor)
  if (quoted !== null) {
    return { prefix: quoted[1]!, query: quoted[2]!, quoted: true }
  }
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor)
  if (plain === null) return undefined
  return { prefix: plain[1]!, query: plain[2]!, quoted: false }
}

/**
 * Word-boundary rule for the `/` trigger (host boundaryOk): start-of-draft,
 * whitespace, and punctuation open; word characters and the URL carve-outs
 * (`//`, `://` after a scheme) do not.
 */
function boundaryOk(text: string, index: number): boolean {
  if (index === 0) return true
  const prev = text.charAt(index - 1)
  if (WHITESPACE_RE.test(prev)) return true
  if (WORD_CHAR_RE.test(prev)) return false
  if (prev === '/') return false
  if (prev === ':' && index >= 2 && !WHITESPACE_RE.test(text.charAt(index - 2))) return false
  return true
}

/**
 * Detect a live trigger token ending at the caret.
 * @param text - the full draft text.
 * @param caret - caret offset into `text`.
 * @returns the probe, or null when no trigger is live at the caret.
 */
export function detectCompletion(text: string, caret: number): CompletionProbe | null {
  const at = activeAtToken(text.slice(0, caret))
  if (at !== undefined) {
    const start = caret - at.prefix.length
    return {
      trigger: '@',
      query: at.query,
      quoted: at.quoted,
      position: text.search(/\S/) === start ? 'leading' : 'inline',
      start,
      end: caret,
    }
  }
  for (let index = caret - 1; index >= 0; index--) {
    const ch = text.charAt(index)
    if (WHITESPACE_RE.test(ch)) return null
    if (ch !== '/') continue
    if (!boundaryOk(text, index)) continue
    return {
      trigger: '/',
      query: text.slice(index + 1, caret),
      quoted: false,
      position: text.search(/\S/) === index ? 'leading' : 'inline',
      start: index,
      end: caret,
    }
  }
  return null
}

/**
 * Whether the guard tier lets this probe open a popup (host TriggerGuard).
 */
export function guardAllowsProbe(guard: CompletionGuard, probe: CompletionProbe): boolean {
  if (guard === 'frozen') return false
  if (guard === 'claimed') return probe.trigger === '@'
  return true
}

/**
 * Probe identity — the dismissed-memory key (host dismissedHit): a settled
 * popup stays closed while the live probe keeps this exact shape.
 */
export function sameProbeIdentity(a: CompletionProbe | null, b: CompletionProbe | null): boolean {
  if (a === null || b === null) return a === null && b === null
  return a.trigger === b.trigger && a.query === b.query && a.quoted === b.quoted
    && a.start === b.start && a.end === b.end
}

/**
 * Format a selected path as prompt text (host `formatFileMention`): quoted
 * `@"path"` for whitespace or an explicitly opened quote, a directory's
 * trailing slash, and a quoted directory keeps that quote open so the drill
 * can descend another level; paths the grammar cannot represent safely are
 * dropped (undefined).
 */
export function formatFileMention(candidate: FileReferenceCandidate, preserveQuote: boolean): string | undefined {
  const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined
  const quoted = preserveQuote || /\s/u.test(path)
  if (!quoted) return `@${path}`
  return candidate.kind === 'directory' ? `@"${path}` : `@"${path}"`
}

/** The pick text a skill row inserts (host skill source onPick: `/name `). */
export function skillInsertion(name: string): string {
  return `/${name} `
}

/** One candidate row, tagged by the data plane it came from. */
export type CompletionOption =
  | { readonly origin: 'command'; readonly row: CommandMenuRow }
  | { readonly origin: 'skill'; readonly name: string; readonly description?: string }
  | {
    readonly origin: 'file'
    readonly path: string
    readonly kind: 'file' | 'directory'
    /** The wire form this pick inserts (formatFileMention output). */
    readonly mention: string
    /** The path's basename — the row's display name. */
    readonly label: string
    /** The parent directory, empty at the workspace root. */
    readonly parent: string
  }
  | {
    readonly origin: 'session'
    /** The canonical wire mention this pick inserts (candidate.mention verbatim). */
    readonly mention: string
    /** The row's display name (the durable display title, else the label). */
    readonly name: string
    /** The workspace location and/or the relative age (native description). */
    readonly description: string
  }

/** One displayed candidate with its group and optional section title. */
export interface CompletionEntry {
  readonly group: 'command' | 'skill' | 'file' | 'session'
  /** Translated section title; a change between neighbours renders a title row. */
  readonly section?: string
  readonly option: CompletionOption
}

/** One candidate group as the MenuView renders it. */
export interface CompletionGroupView {
  readonly id: 'command' | 'skill' | 'file' | 'session'
  readonly status: 'ready' | 'pending'
  /**
   * Source-group title (指令/技能), rendered when no entry carries a section
   * (host rule: sectioned rows suppress the source title).
   */
  readonly title?: string
  readonly entries: readonly CompletionEntry[]
}

/** One popup render's data: the groups, their order, and the pending flag. */
export interface CompletionView {
  readonly groups: readonly CompletionGroupView[]
  /**
   * True while a displayed group awaits fresh candidates — Enter/Tab are
   * consumed (never pick a stale row), the stale rows stay visible (SWR).
   */
  readonly pending: boolean
}

/** Assembly inputs for one popup render. */
export interface CompletionViewInput {
  readonly probe: CompletionProbe
  /**
   * The assembled command rows (leading-filtered, availability-filtered —
   * the `+` menu's own assembly); null while the command plane is absent.
   */
  readonly commandRows: readonly CommandMenuRow[] | null
  /** The session's skill roll; null while the lexicon read is pending. */
  readonly skills: readonly SkillEntry[] | null
  /** Landed candidates for the live query; null while none apply. */
  readonly files: readonly FileReferenceCandidate[] | null
  /** Previous results kept visible while the fresh fetch runs (SWR). */
  readonly staleFiles: readonly FileReferenceCandidate[] | null
  /**
   * Landed session-mention candidates for the live query (null while the
   * batch is pending); empty when the plane is absent, the token is quoted
   * (native: no session query on an open quote), or nothing matched.
   * Undefined reads as null (callers predating the session plane).
   */
  readonly sessions?: readonly SessionMentionCandidate[] | null
  /** Previous session candidates kept visible while the fresh fetch runs. */
  readonly staleSessions?: readonly SessionMentionCandidate[] | null
  /** The display environment of the session rows (see {@link SessionRowEnvironment}). */
  readonly sessionEnv?: SessionRowEnvironment
  readonly t: (key: ComposerKey, params?: Record<string, unknown>) => string
}

/**
 * The display environment the session rows read (the native source's fold
 * inputs): the owning session (the subagent linkage compares parents
 * against it), the render clock, the user's home (path abbreviation), and
 * the host session-list snapshot (`byId`) the ages and subagent facts come
 * from — absent snapshots degrade every row to its candidate-borne facts.
 */
export interface SessionRowEnvironment {
  readonly sessionId: string
  readonly now: number
  readonly home?: string
  readonly summaries?: Readonly<Record<string, SessionSummaryLike | undefined>>
}

/** Whether a candidate is a subagent of the session the popup serves. */
function isSubagentOf(candidate: SessionMentionCandidate, env: SessionRowEnvironment): boolean {
  const summary = env.summaries?.[candidate.sessionId]
  if (summary === undefined || summary === null || summary.origin !== 'subagent') return false
  // The upstream source reads its own `parentId` spelling while the typed
  // field is `parentSessionId` (a src/lib drift at rc.2) — real hosts
  // answer either, so both are read.
  const parent = summary.parentSessionId ?? summary.parentId
  return typeof parent === 'string' && parent === env.sessionId
}

/**
 * Project host session candidates into display entries: subagents of the
 * served session under their section, then the other sessions (native row
 * order, resolver ranking preserved). The description names the workspace
 * only when it differs from the current one, joined with the row's age.
 */
function projectSessions(
  candidates: readonly SessionMentionCandidate[],
  env: SessionRowEnvironment,
  t: (key: ComposerKey, params?: Record<string, unknown>) => string,
): CompletionEntry[] {
  const subagentSection = t('completion.section.subagents')
  const sessionSection = t('completion.section.sessions')
  const describe = (candidate: SessionMentionCandidate): string => {
    const summary = env.summaries?.[candidate.sessionId]
    const at = typeof summary?.updatedAt === 'number' ? summary.updatedAt : candidate.createdAt
    const { unit, n } = relativeTime(at, env.now)
    const age = unit === 'now' ? t('completion.time.now') : t(`completion.time.${unit}`, { n })
    // Candidates are ranked by workspace affinity, so the location only
    // tells the user something when it is not the workspace they are in.
    const location = candidate.sameWorkspace
      ? undefined
      : candidate.cwd === undefined ? t('completion.candidate.noCwd') : abbreviateHomePath(candidate.cwd, env.home)
    return location === undefined ? age : `${location} · ${age}`
  }
  const entryOf = (candidate: SessionMentionCandidate, child: boolean): CompletionEntry => ({
    group: 'session',
    section: child ? subagentSection : sessionSection,
    option: {
      origin: 'session',
      mention: candidate.mention,
      name: candidate.displayTitle ?? candidate.label,
      description: describe(candidate),
    },
  })
  const entries: CompletionEntry[] = []
  const others: CompletionEntry[] = []
  for (const candidate of candidates) {
    const child = isSubagentOf(candidate, env)
    ;(child ? entries : others).push(entryOf(candidate, child))
  }
  return [...entries, ...others]
}

/** Project host candidates into display entries, dropping unformattable paths. */
function projectFiles(
  candidates: readonly FileReferenceCandidate[],
  preserveQuote: boolean,
  section: string,
): CompletionEntry[] {
  const entries: CompletionEntry[] = []
  for (const candidate of candidates) {
    const mention = formatFileMention(candidate, preserveQuote)
    if (mention === undefined) continue
    const slash = candidate.path.lastIndexOf('/')
    entries.push({
      group: 'file',
      section,
      option: {
        origin: 'file',
        path: candidate.path,
        kind: candidate.kind,
        mention,
        label: candidate.path.slice(slash + 1),
        parent: slash < 0 ? '' : candidate.path.slice(0, slash),
      },
    })
  }
  return entries
}

/**
 * Assemble one popup render's groups.
 * @param input - probe, group data (null = pending/absent), and copy.
 * @returns the display groups, or null when the probe's trigger has no data
 * plane (the popup face stays hidden — plain text input is unaffected).
 */
export function assembleCompletionView(input: CompletionViewInput): CompletionView | null {
  const { probe, commandRows, skills, files, staleFiles, t } = input
  // Undefined reads as an ABSENT plane (empty, group omitted): callers
  // without a session plane predate the session group. An explicit `null`
  // is the caller's pending marker (the fetch is in flight, nothing stale).
  const sessions = input.sessions === undefined ? [] : input.sessions
  const staleSessions = input.staleSessions === undefined ? null : input.staleSessions
  const sessionEnv: SessionRowEnvironment = input.sessionEnv ?? { sessionId: '', now: 0 }
  if (probe.trigger === '/') {
    if (commandRows === null) return null
    const commandGroup: CompletionGroupView = probe.query === ''
      ? {
        id: 'command',
        status: 'ready',
        entries: commandRows.map((row) => ({
          group: 'command' as const,
          section: row.section,
          option: { origin: 'command' as const, row },
        })),
      }
      : {
        id: 'command',
        status: 'ready',
        title: t('completion.group.command'),
        entries: rankByName(commandRows, probe.query).map((row) => ({
          group: 'command' as const,
          option: { origin: 'command' as const, row },
        })),
      }
    const skillGroup: CompletionGroupView = skills === null
      ? { id: 'skill', status: 'pending', title: t('completion.group.skill'), entries: [] }
      : {
        id: 'skill',
        status: 'ready',
        title: t('completion.group.skill'),
        entries: rankByName(skills, probe.query).map((skill) => ({
          group: 'skill' as const,
          option: {
            origin: 'skill' as const,
            name: skill.name,
            description: skill.modelInvocable === false
              ? (skill.description === undefined
                ? t('completion.skill.userOnly')
                : `${t('completion.skill.userOnly')} · ${skill.description}`)
              : skill.description,
          },
        })),
      }
    const groups = [commandGroup, skillGroup]
    return { groups, pending: groups.some((group) => group.status === 'pending') }
  }
  if (files === null && staleFiles === null && sessions === null && staleSessions === null) {
    // No landed results and nothing stale on either plane: the pending
    // skeleton is the one group (the native single-MenuView shape).
    return {
      groups: [{ id: 'file', status: 'pending', entries: [] }],
      pending: true,
    }
  }
  const source = files ?? staleFiles ?? []
  const section = t('completion.section.files')
  const groups: CompletionGroupView[] = [{
    id: 'file',
    status: files === null ? 'pending' : 'ready',
    entries: projectFiles(source, probe.quoted, section),
  }]
  // The session group rides the same batch (the native source reads both
  // planes in parallel). `null` sessions with nothing stale mean the fetch
  // is in flight — its own pending skeleton; a landed empty list (plane
  // absent, quoted token, no matches) omits the group whole.
  const sessionSource = sessions ?? staleSessions ?? []
  if (sessions === null && staleSessions === null) {
    groups.push({ id: 'session', status: 'pending', entries: [] })
  } else if (sessionSource.length > 0) {
    groups.push({
      id: 'session',
      status: files === null ? 'pending' : 'ready',
      entries: projectSessions(sessionSource, sessionEnv, t),
    })
  }
  return { groups, pending: groups.some((group) => group.status === 'pending') }
}
