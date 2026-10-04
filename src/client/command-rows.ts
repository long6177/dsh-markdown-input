/**
 * The `+` menu's row assembly: the pure decision layer between the host
 * command catalog (or the static fallback) and the rendered menu. Mirrors
 * the host's candidate composition (ui-commands service.ts + presentation.ts):
 * built-in commands localize through a client face table keyed by
 * definitionId (the host descriptors carry English catalog text only),
 * `file` and `model` are client contributions absent from the catalog,
 * availability filters rows, the non-leading position drops claim rows
 * (a mid-draft `/goal` never claims), and the two-section order follows the
 * host SECTION_ROWS table — 添加 (file/goal/plan/feedback) then 指令
 * (compact/permission/model/export), unlisted catalog rows closing 指令.
 *
 * The dispatch decision table (service.ts:251-275) collapses here into row
 * kinds, in the host's own order contribution → decoration → input claim →
 * bare execute: `claim` (host commands with input — the menu inserts the
 * localized claim token and Enter submits through the host's adjudication),
 * `execute` (bare commands — detached `remote.commands.execute`), `popup`
 * (the permission/model rows chain into the second-layer popup faces),
 * `action` (the file row rides the hidden file input), and `feedback` (the
 * host `feedback` command while its `feedbackUi` decoration is alive — a
 * pick opens the session feedback dialog and inserts nothing, exactly the
 * native decoration; without the service the row stays a `claim`, see
 * feedback-face.ts).
 */
import type { ComponentType } from 'react'
import {
  IconCompactOutlineRegular, IconDownloadOutlineRegular, IconDataOutlineRegular,
  IconGoalOutlineRegular, IconPaperclipOutlineRegular, IconPaperPlaneOutlineRegular,
  IconPlanOutlineRegular, PermissionIconFullAccessRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommandDescriptor, CommandExecuteResult } from './command-face.ts'
import type { ChainPopupId } from './chain-open.ts'
import type { ComposerKey } from './locales.ts'

/** The menu's two sections (host MenuSection). */
export type CommandMenuSection = 'add' | 'commands'

/** What picking a row does (host dispatch decision table). */
export type CommandMenuRowKind = 'claim' | 'execute' | 'popup' | 'action' | 'feedback'

/** One assembled menu row. */
export interface CommandMenuRow {
  /** Command name (without slash) or contribution key. */
  readonly name: string
  /** Localized display title. */
  readonly label: string
  /** One-line summary, rendered right-aligned; absent on the file row (native parity). */
  readonly description?: string
  /** 14px glyph component. */
  readonly icon?: ComponentType<IconProps>
  readonly kind: CommandMenuRowKind
  /** Localized section title the row sits under. */
  readonly section: string
  /** Claim token text (leading slash + trailing space), for `claim` rows. */
  readonly token?: string
  /** Detached command line, for `execute` rows. */
  readonly line?: string
  /** Which second-layer popup face, for `popup` rows. */
  readonly popup?: ChainPopupId
}

/** Translator over the composer dictionary (the chain props' `t` seat). */
export type CommandRowsTranslate = (key: ComposerKey) => string

/** The first-party definition ids and their client faces (host BUILTINS + HOST_FACES). */
const BUILTIN_FACES = {
  goal: {
    definitionId: '@deepseek-ai/dsh-command-goal',
    label: 'command.label.goal', description: 'command.description.goal',
    token: 'command.token.goal', icon: IconGoalOutlineRegular,
  },
  plan: {
    definitionId: '@deepseek-ai/dsh-plan-mode',
    label: 'command.label.plan', description: 'command.description.plan',
    token: 'command.token.plan', icon: IconPlanOutlineRegular,
  },
  feedback: {
    definitionId: '@deepseek-ai/dsh-command-feedback',
    label: 'command.label.feedback', description: 'command.description.feedback',
    token: 'command.token.feedback', icon: IconPaperPlaneOutlineRegular,
  },
  compact: {
    definitionId: '@deepseek-ai/dsh-command-compact',
    label: 'command.label.compact', description: 'command.description.compact',
    token: undefined, icon: IconCompactOutlineRegular,
  },
  permission: {
    definitionId: '@deepseek-ai/dsh-permission-presets',
    label: 'command.label.permission', description: 'command.description.permission',
    token: 'command.token.permission', icon: PermissionIconFullAccessRegular,
  },
  export: {
    definitionId: '@deepseek-ai/dsh-session-log-export',
    label: 'command.label.export', description: 'command.description.export',
    token: undefined, icon: IconDownloadOutlineRegular,
  },
} as const

type BuiltinName = keyof typeof BUILTIN_FACES

const BUILTIN_NAMES = Object.keys(BUILTIN_FACES) as BuiltinName[]

/**
 * Identify a first-party definition without interpreting its display copy
 * (host builtinCommandName).
 * @param descriptor - effective host descriptor.
 */
function builtinNameOf(descriptor: CommandDescriptor): BuiltinName | undefined {
  return BUILTIN_NAMES.find((name) => descriptor.definitionId === BUILTIN_FACES[name].definitionId)
}

/**
 * The static fallback catalog: the six first-party host commands with the
 * input flags the host registers. Rendered while the catalog RPC has not
 * answered (or failed) so the menu never opens empty; the two client
 * contributions (file/model) join through their availability flags.
 */
const SYNTHETIC_CATALOG: readonly CommandDescriptor[] = BUILTIN_NAMES.map((name) => ({
  definitionId: BUILTIN_FACES[name].definitionId,
  name,
  description: '',
  // The claim commands are exactly the built-ins with a localized claim
  // token (goal/plan/feedback/permission); compact and export are bare —
  // one source of truth for both encodings.
  ...(BUILTIN_FACES[name].token === undefined ? {} : { input: { hint: '' } }),
}))

/** The host SECTION_ROWS table: row names per section, highest usage first. */
const SECTION_ROWS: Readonly<Record<'add' | 'commands', readonly string[]>> = {
  add: ['file', 'goal', 'plan', 'feedback'],
  commands: ['compact', 'permission', 'model', 'export'],
}

/**
 * Map a detached execution outcome onto the card banner (host parity:
 * success is silent — the flow node renders in the conversation). Shared by
 * the `+` menu and the completion popups' execute-row dispatch.
 */
export function reportExecute(
  result: CommandExecuteResult,
  onError: (text: string) => void,
  t: (key: ComposerKey, params?: Record<string, unknown>) => string,
): void {
  if (result.kind === 'success') return
  if (result.kind === 'error') { onError(t('command.executeError', { text: result.text })) }
  else if (result.kind === 'unmatched') { onError(t('command.executeUnmatched')) }
  else { onError(t('command.executeFailed', { message: result.message })) }
}

/** Assembly inputs. */
export interface CommandRowsInput {
  /** The session's host catalog; null while unavailable (static fallback). */
  readonly descriptors: readonly CommandDescriptor[] | null
  /** File intake availability (attachment face + non-subagent + not busy). */
  readonly canPickFiles: boolean
  /** The permission popup face is alive and chainable. */
  readonly canChainPermission: boolean
  /** The model popup face is alive and chainable. */
  readonly canChainModel: boolean
  /**
   * The host `feedbackUi` service is present (feedback-face.ts): the feedback
   * row becomes the native decoration `feedback` row instead of a claim.
   */
  readonly canOpenFeedback: boolean
  /** Only whitespace precedes the caret (leading trigger position). */
  readonly leading: boolean
  readonly t: CommandRowsTranslate
}

/**
 * Assemble the menu rows for one open.
 * @param input - catalog or fallback, availability flags, trigger position, copy.
 * @returns the sectioned rows in display order.
 */
export function assembleCommandRows(input: CommandRowsInput): readonly CommandMenuRow[] {
  const { descriptors, canPickFiles, canChainPermission, canChainModel, canOpenFeedback, leading, t } = input
  const addTitle = t('command.menu.section.add')
  const commandsTitle = t('command.menu.section.commands')
  const catalog = descriptors ?? SYNTHETIC_CATALOG

  // Client contributions (host apply.ts:271-280, ui-model-selection index.ts).
  const contributions = new Map<string, CommandMenuRow>()
  if (canPickFiles) {
    contributions.set('file', {
      name: 'file', label: t('command.menu.file'), icon: IconPaperclipOutlineRegular,
      kind: 'action', section: addTitle,
    })
  }
  if (canChainModel) {
    contributions.set('model', {
      name: 'model', label: t('command.menu.model'),
      description: t('command.menu.model.description'), icon: IconDataOutlineRegular,
      kind: 'popup', popup: 'model', section: commandsTitle,
    })
  }

  const rows = new Map<string, Omit<CommandMenuRow, 'section'>>()
  for (const descriptor of catalog) {
    if (contributions.has(descriptor.name)) continue // a collision never shadows a contribution
    const builtin = builtinNameOf(descriptor)
    const face = builtin === undefined ? undefined : BUILTIN_FACES[builtin]
    // The popup chain (the second-layer faces) replaces a row's own
    // dispatch: permission while its popup face is alive, and the model
    // contribution below (model is not in the host catalog at all).
    const popupId = descriptor.name === 'permission' && canChainPermission
      ? 'permission' as const
      : undefined
    // The native decoration outranks the host `input` claim: while the
    // feedbackUi service is alive the feedback row opens the dialog and
    // inserts nothing; a service-less host keeps today's claim row.
    const feedbackAction = builtin === 'feedback' && canOpenFeedback
    const kind: CommandMenuRowKind = feedbackAction
      ? 'feedback'
      : popupId !== undefined
        ? 'popup'
        : descriptor.input !== undefined ? 'claim' : 'execute'
    rows.set(descriptor.name, {
      name: descriptor.name,
      label: face === undefined ? descriptor.name : t(face.label),
      description: face === undefined ? descriptor.description : t(face.description),
      ...(face === undefined ? {} : { icon: face.icon }),
      kind,
      ...(kind === 'claim' ? {
        token: `/${face?.token === undefined ? descriptor.name : t(face.token)} `,
      } : {}),
      ...(kind === 'execute' ? { line: `/${descriptor.name}` } : {}),
      ...(kind === 'popup' ? { popup: popupId } : {}),
    })
  }
  for (const [name, row] of contributions) rows.set(name, row)

  // The non-leading position drops claim rows (host position filter: a
  // mid-draft `/goal` never claims) — a row the decoration upgraded to a
  // `feedback` action carries no hint and stays visible inline, exactly like
  // the native decorated row and our popup/execute rows.
  const visible = [...rows.values()].filter((row) => leading || row.kind !== 'claim')

  // Section order: the SECTION_ROWS table, then unlisted rows closing 指令
  // in catalog order; a row's section comes from the list it lands in.
  const listed = new Set([...SECTION_ROWS.add, ...SECTION_ROWS.commands])
  const pick = (names: readonly string[], section: string): CommandMenuRow[] =>
    names.flatMap((name) => {
      const row = visible.find((candidate) => candidate.name === name)
      return row === undefined ? [] : [{ ...row, section }]
    })
  const commandsRows = [
    ...pick(SECTION_ROWS.commands, commandsTitle),
    ...visible.filter((row) => !listed.has(row.name)).map((row) => ({ ...row, section: commandsTitle })),
  ]
  return [...pick(SECTION_ROWS.add, addTitle), ...commandsRows]
}
