/**
 * Seam: the `+` menu's row assembly — the pure decision layer between the
 * host catalog (or the static fallback) and the rendered menu. Mirrors the
 * host's candidate composition: built-in commands localize through the
 * client face table keyed by definitionId, the file/model rows are client
 * contributions, availability filters rows, the non-leading position drops
 * claim rows, and the two-section order (添加 file/goal/plan/feedback,
 * 指令 compact/permission/model/export, unlisted rows closing 指令) follows
 * the host SECTION_ROWS table. The feedback row's native decoration (#35)
 * upgrades it to the dialog action while the host `feedbackUi` service is
 * alive, and stays a claim row without it.
 */
import { describe, expect, it } from 'vitest'
import {
  IconCompactOutlineRegular, IconDownloadOutlineRegular, IconDataOutlineRegular,
  IconGoalOutlineRegular, IconPaperclipOutlineRegular, IconPaperPlaneOutlineRegular,
  IconPlanOutlineRegular, PermissionIconFullAccessRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { assembleCommandRows, type CommandDescriptor } from '../src/client/command-rows.ts'
import { en, zh } from '../src/client/locales.ts'

function fakeT(locale: Record<string, string>): (key: never) => string {
  return (key) => locale[key as string] ?? key
}
const tZh = fakeT(zh) as never as Parameters<typeof assembleCommandRows>[0]['t']
const tEn = fakeT(en) as never as Parameters<typeof assembleCommandRows>[0]['t']

const GOAL: CommandDescriptor = {
  definitionId: '@deepseek-ai/dsh-command-goal', name: 'goal',
  description: 'Set or view the goal', input: { hint: '[<objective>|clear]' },
}
const PLAN: CommandDescriptor = {
  definitionId: '@deepseek-ai/dsh-plan-mode', name: 'plan',
  description: 'Enter or leave plan mode', input: { hint: '[off|message]' },
}
const FEEDBACK: CommandDescriptor = {
  definitionId: '@deepseek-ai/dsh-command-feedback', name: 'feedback',
  description: 'Record feedback', input: { hint: '<text>' },
}
const COMPACT: CommandDescriptor = {
  definitionId: '@deepseek-ai/dsh-command-compact', name: 'compact',
  description: 'Compact older conversation history',
}
const PERMISSION: CommandDescriptor = {
  definitionId: '@deepseek-ai/dsh-permission-presets', name: 'permission',
  description: 'Switch the permission preset', input: { hint: '<preset>' },
}
const EXPORT: CommandDescriptor = {
  definitionId: '@deepseek-ai/dsh-session-log-export', name: 'export',
  description: 'Download this Session log as a ZIP archive',
}
const HOST_BUILTINS = [GOAL, PLAN, FEEDBACK, COMPACT, PERMISSION, EXPORT]

const FULL = {
  canPickFiles: true,
  canChainPermission: true,
  canChainModel: true,
  canOpenFeedback: false,
  leading: true,
}

/** The host build whose ui-message-feedback decoration is alive (#35). */
const FULL_WITH_FEEDBACK = { ...FULL, canOpenFeedback: true }

function zhRows(descriptors: readonly CommandDescriptor[] | null, overrides: Partial<typeof FULL> = {}) {
  return assembleCommandRows({ descriptors, ...FULL, ...overrides, t: tZh })
}

function names(rows: ReturnType<typeof zhRows>): string[] {
  return rows.map((row) => row.name)
}

describe('assembleCommandRows section order', () => {
  it('orders the full eight: 添加 (file/goal/plan/feedback) then 指令 (compact/permission/model/export)', () => {
    const rows = zhRows(HOST_BUILTINS)
    expect(names(rows)).toEqual([
      'file', 'goal', 'plan', 'feedback',
      'compact', 'permission', 'model', 'export',
    ])
  })

  it('labels rows with the localized section title, add before commands', () => {
    const rows = zhRows(HOST_BUILTINS)
    expect(rows.slice(0, 4).map((row) => row.section)).toEqual(['添加', '添加', '添加', '添加'])
    expect(rows.slice(4).map((row) => row.section)).toEqual(['指令', '指令', '指令', '指令'])
  })

  it('skips missing rows and appends unlisted catalog rows to the 指令 section', () => {
    const custom: CommandDescriptor = { name: 'custom', description: 'A custom command' }
    const rows = zhRows([custom, GOAL, COMPACT])
    expect(names(rows)).toEqual(['file', 'goal', 'compact', 'model', 'custom'])
    expect(rows[4]?.section).toBe('指令')
  })
})

describe('assembleCommandRows row faces', () => {
  it('localizes built-in rows through the definitionId face table with icons', () => {
    const rows = zhRows(HOST_BUILTINS)
    const byName = new Map(rows.map((row) => [row.name, row]))
    expect(byName.get('goal')).toMatchObject({ label: '目标', description: '设置或查看长期任务目标' })
    expect(byName.get('goal')?.icon).toBe(IconGoalOutlineRegular)
    expect(byName.get('plan')?.icon).toBe(IconPlanOutlineRegular)
    expect(byName.get('feedback')?.icon).toBe(IconPaperPlaneOutlineRegular)
    expect(byName.get('compact')?.icon).toBe(IconCompactOutlineRegular)
    expect(byName.get('permission')?.icon).toBe(PermissionIconFullAccessRegular)
    expect(byName.get('export')?.icon).toBe(IconDownloadOutlineRegular)
  })

  it('falls back to the catalog description for unknown commands (no icon, no label)', () => {
    const rows = zhRows([{ name: 'custom', description: 'A custom command' }])
    const custom = rows.find((row) => row.name === 'custom')
    expect(custom).toMatchObject({ label: 'custom', description: 'A custom command' })
    expect(custom?.icon).toBeUndefined()
  })

  it('renders the en alias decision data: label differing from name keeps the alias', () => {
    const rows = assembleCommandRows({
      descriptors: HOST_BUILTINS, ...FULL, t: tEn,
    })
    const byName = new Map(rows.map((row) => [row.name, row]))
    // en: label 'Goal' vs name 'goal' differs only by case → no alias.
    expect(byName.get('goal')?.label).toBe('Goal')
    expect(byName.get('goal')?.name).toBe('goal')
    // zh: label 目标 vs name goal → alias shows.
    const zhRow = zhRows(HOST_BUILTINS).find((row) => row.name === 'goal')
    expect(zhRow?.label).toBe('目标')
  })

  it('carries the file row without a description (native parity) and the model row with one', () => {
    const rows = zhRows(HOST_BUILTINS)
    const file = rows.find((row) => row.name === 'file')
    expect(file).toMatchObject({ label: '文件', icon: IconPaperclipOutlineRegular })
    expect(file?.description).toBeUndefined()
    const model = rows.find((row) => row.name === 'model')
    expect(model).toMatchObject({
      label: '模型', description: '选择本会话使用的模型', icon: IconDataOutlineRegular,
    })
  })
})

describe('assembleCommandRows kinds', () => {
  it('routes goal/plan/feedback to localized claim tokens and bare commands to execute lines', () => {
    const rows = new Map(zhRows(HOST_BUILTINS).map((row) => [row.name, row]))
    expect(rows.get('goal')).toMatchObject({ kind: 'claim', token: '/目标 ' })
    expect(rows.get('plan')).toMatchObject({ kind: 'claim', token: '/计划 ' })
    expect(rows.get('feedback')).toMatchObject({ kind: 'claim', token: '/反馈 ' })
    expect(rows.get('compact')).toMatchObject({ kind: 'execute', line: '/compact' })
    expect(rows.get('export')).toMatchObject({ kind: 'execute', line: '/export' })
  })

  it('localizes en claim tokens to the command name itself (host alias resolution)', () => {
    const rows = new Map(assembleCommandRows({
      descriptors: HOST_BUILTINS, ...FULL, t: tEn,
    }).map((row) => [row.name, row]))
    expect(rows.get('goal')).toMatchObject({ kind: 'claim', token: '/goal ' })
    expect(rows.get('plan')).toMatchObject({ kind: 'claim', token: '/plan ' })
  })

  it('chains permission/model into their popups while those popup faces are alive', () => {
    const rows = new Map(zhRows(HOST_BUILTINS).map((row) => [row.name, row]))
    expect(rows.get('permission')).toMatchObject({ kind: 'popup', popup: 'permission' })
    expect(rows.get('model')).toMatchObject({ kind: 'popup', popup: 'model' })
  })

  it('falls permission back to a claim row while its popup face is dead; model hides', () => {
    const rows = new Map(zhRows(HOST_BUILTINS, {
      canChainPermission: false, canChainModel: false,
    }).map((row) => [row.name, row]))
    expect(rows.get('permission')).toMatchObject({ kind: 'claim', token: '/权限 ' })
    expect(rows.has('model')).toBe(false)
  })

  it('marks the file row an action', () => {
    const file = zhRows(HOST_BUILTINS).find((row) => row.name === 'file')
    expect(file?.kind).toBe('action')
  })

  it('gives an unknown args-taking command a claim row over its registered name', () => {
    const rows = zhRows([{ name: 'custom', description: 'x', input: { hint: '<arg>' } }])
    expect(rows.find((row) => row.name === 'custom')).toMatchObject({ kind: 'claim', token: '/custom ' })
  })
})

describe('assembleCommandRows feedback decoration (#35)', () => {
  it('opens the dialog without claiming while the feedbackUi service is alive', () => {
    // The native host decoration (ui-message-feedback index.ts:139) outranks
    // the descriptor's `input`: the row must carry no token and no line.
    const feedback = zhRows(HOST_BUILTINS, FULL_WITH_FEEDBACK)
      .find((row) => row.name === 'feedback')
    expect(feedback).toMatchObject({
      kind: 'feedback', label: '反馈', description: '发送关于当前会话的反馈',
      icon: IconPaperPlaneOutlineRegular, section: '添加',
    })
    expect(feedback?.token).toBeUndefined()
    expect(feedback?.line).toBeUndefined()
  })

  it('keeps the row order and the other kinds untouched by the upgrade', () => {
    const rows = zhRows(HOST_BUILTINS, FULL_WITH_FEEDBACK)
    expect(names(rows)).toEqual([
      'file', 'goal', 'plan', 'feedback',
      'compact', 'permission', 'model', 'export',
    ])
    const byName = new Map(rows.map((row) => [row.name, row]))
    expect(byName.get('goal')).toMatchObject({ kind: 'claim', token: '/目标 ' })
    expect(byName.get('permission')).toMatchObject({ kind: 'popup', popup: 'permission' })
    expect(byName.get('compact')).toMatchObject({ kind: 'execute', line: '/compact' })
    expect(byName.get('file')?.kind).toBe('action')
  })

  it('keeps the action visible at an inline caret (the decoration carries no hint)', () => {
    // The host position filter drops rows with a hint only
    // (service.ts:247); a decorated row has none and stays visible.
    const rows = zhRows(HOST_BUILTINS, { ...FULL_WITH_FEEDBACK, leading: false })
    expect(names(rows)).toEqual(['file', 'feedback', 'compact', 'permission', 'model', 'export'])
    expect(rows.find((row) => row.name === 'feedback')?.kind).toBe('feedback')
  })

  it('falls back to today\'s claim row on a host without the service', () => {
    const feedback = zhRows(HOST_BUILTINS).find((row) => row.name === 'feedback')
    expect(feedback).toMatchObject({ kind: 'claim', token: '/反馈 ' })
  })

  it('covers the static fallback catalog too: descriptor-less feedback is detected by definitionId', () => {
    // The catalog read has not answered: the synthetic catalog still resolves
    // the built-in by definitionId, so the upgrade needs no catalog.
    const feedback = zhRows(null, FULL_WITH_FEEDBACK).find((row) => row.name === 'feedback')
    expect(feedback).toMatchObject({ kind: 'feedback' })
    expect(feedback?.token).toBeUndefined()
  })

  it('leaves a non-builtin feedback-shaped row on its own dispatch', () => {
    // Only the first-party definition id is the decorated host command: a
    // custom command that happens to be called `feedback` keeps its claim.
    const foreign: CommandDescriptor = { name: 'feedback', description: 'A custom command', input: { hint: '<text>' } }
    const row = zhRows([foreign], FULL_WITH_FEEDBACK).find((candidate) => candidate.name === 'feedback')
    expect(row).toMatchObject({ kind: 'claim', token: '/feedback ' })
  })
})

describe('assembleCommandRows availability', () => {
  it('drops the file row when file intake is unavailable (busy/subagent/no attachment face)', () => {
    const rows = zhRows(HOST_BUILTINS, { canPickFiles: false })
    expect(names(rows)).not.toContain('file')
  })

  it('drops claim rows when the caret sits after text (inline position, native filter)', () => {
    const rows = zhRows(HOST_BUILTINS, { leading: false })
    expect(names(rows)).toEqual(['file', 'compact', 'permission', 'model', 'export'])
  })

  it('falls back to the static built-in catalog while the host catalog is unavailable', () => {
    const rows = zhRows(null)
    expect(names(rows)).toEqual([
      'file', 'goal', 'plan', 'feedback',
      'compact', 'permission', 'model', 'export',
    ])
    expect(rows.find((row) => row.name === 'goal')).toMatchObject({ kind: 'claim', token: '/目标 ' })
    expect(rows.find((row) => row.name === 'compact')).toMatchObject({ kind: 'execute', line: '/compact' })
  })
})
