/**
 * Pure core of the Agent-preset seat (issue #42, ADR-0006 option B): which
 * preset the seat names, which rows its menu offers, when the whole face
 * exists, and how a refused switch reads. The host's UI package is not in
 * this build's dependency graph, so the data semantics are what the card
 * implements — and they are pinned here.
 */
import { describe, expect, it } from 'vitest'
import {
  agentPresetCurrentId, agentPresetDisplayName, agentPresetMenuItems, agentPresetOptions,
  agentPresetProjectionOf, agentPresetRefusal, agentPresetSeatVisible, isBuiltInPreset,
  presetDisplayText, resolveAgentPresetCopy,
  type AgentPresetOption,
  type BuiltInPresetCopyKey,
} from '../src/client/agent-preset-core.ts'

const STANDARD: AgentPresetOption = { id: 'standard' }
const CORDIS: AgentPresetOption = { id: 'cordis', name: 'Creator mode', description: 'Build plugins by talking.' }

/**
 * The host `settings.agentPreset` dictionary's display copy, verbatim from
 * `ui-agent-preset/src/client/locales.ts` (en) — the very words the native
 * chip renders for a shipped preset whose row publishes no `name`.
 */
const HOST_DICT: Record<string, string> = {
  presetStandardName: 'Standard mode',
  presetStandardDescription: 'Work with code, files, and information.',
  presetPtcName: 'PTC mode',
  presetPtcDescription: 'Batch tool calls, then filter and summarize.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription: 'Terminal tool only.',
  presetCordisName: 'Creator mode',
  presetCordisDescription: 'Customize DSH through conversation.',
  seatHint: 'Choose the agent preset for your new task',
  noDescription: 'No description.',
  switchRefused: 'Could not switch to {name}: {reason}',
}

const HOST_T = (key: BuiltInPresetCopyKey): string => HOST_DICT[key] ?? key

describe('agentPresetOptions', () => {
  it('offers healthy presets only, in roster order', () => {
    const options = agentPresetOptions({
      presets: [STANDARD, { id: 'broken', broken: 'cannot mount' }, CORDIS],
    })
    expect(options.map(option => option.id)).toEqual(['standard', 'cordis'])
  })
})

describe('agentPresetCurrentId', () => {
  it('names the session projection when one is recorded', () => {
    expect(agentPresetCurrentId({
      projection: 'cordis',
      options: [STANDARD, CORDIS],
      defaults: ['standard'],
    })).toBe('cordis')
  })

  it('falls back to the deployment default, then the first option', () => {
    expect(agentPresetCurrentId({
      projection: null,
      options: [STANDARD, CORDIS],
      defaults: ['cordis'],
    })).toBe('cordis')
    expect(agentPresetCurrentId({
      projection: null,
      options: [STANDARD, CORDIS],
      defaults: [],
    })).toBe('standard')
  })

  it('keeps naming a recorded preset the roster no longer carries', () => {
    // A running session keeps the composition it began with; the chip says so
    // rather than silently renaming it to the deployment default.
    expect(agentPresetCurrentId({
      projection: 'retired',
      options: [STANDARD],
      defaults: ['standard'],
    })).toBe('retired')
  })

  it('answers undefined when the roster offers nothing', () => {
    expect(agentPresetCurrentId({ projection: null, options: [], defaults: [] })).toBeUndefined()
  })
})

describe('agentPresetMenuItems', () => {
  it('maps roster rows to name + description, with the seat copy for a missing one', () => {
    expect(agentPresetMenuItems([STANDARD, CORDIS], undefined, 'No description.')).toEqual([
      { id: 'standard', label: 'standard', description: 'No description.' },
      { id: 'cordis', label: 'Creator mode', description: 'Build plugins by talking.' },
    ])
  })

  it('localizes the shipped rows through the host dictionary and keeps custom metadata', () => {
    expect(agentPresetMenuItems([STANDARD, CORDIS], HOST_T, 'No description.')).toEqual([
      { id: 'standard', label: 'Standard mode', description: 'Work with code, files, and information.' },
      { id: 'cordis', label: 'Creator mode', description: 'Build plugins by talking.' },
    ])
  })

  it('falls back to the seat copy when the host dictionary never resolves a description', () => {
    expect(agentPresetMenuItems([{ id: 'custom-tool' }], HOST_T, 'No description.')).toEqual([
      { id: 'custom-tool', label: 'custom-tool', description: 'No description.' },
    ])
  })
})

describe('agentPresetDisplayName', () => {
  it('prefers the roster name, falling back to the id (the host fallback)', () => {
    expect(agentPresetDisplayName([STANDARD, CORDIS], 'cordis', undefined)).toBe('Creator mode')
    expect(agentPresetDisplayName([STANDARD, CORDIS], 'standard', undefined)).toBe('standard')
    expect(agentPresetDisplayName([STANDARD], undefined, undefined)).toBeUndefined()
  })

  it('localizes a shipped current preset through the host dictionary', () => {
    expect(agentPresetDisplayName([STANDARD, CORDIS], 'standard', HOST_T)).toBe('Standard mode')
  })

  it('keeps naming a retired id as-is even with the host dictionary bound', () => {
    expect(agentPresetDisplayName([STANDARD], 'retired', HOST_T)).toBe('retired')
  })
})

describe('agentPresetSeatVisible', () => {
  it('hides when the projection KEY was never contributed', () => {
    expect(agentPresetSeatVisible(undefined, [STANDARD])).toBe(false)
  })

  it('shows on a live projection key with no recorded preset (null)', () => {
    expect(agentPresetSeatVisible(null, [STANDARD])).toBe(true)
  })

  it('hides when the roster offers nothing to choose between', () => {
    expect(agentPresetSeatVisible('standard', [])).toBe(false)
  })

  it('shows on a live value with a roster', () => {
    expect(agentPresetSeatVisible('standard', [STANDARD, CORDIS])).toBe(true)
  })
})

describe('agentPresetProjectionOf', () => {
  it('normalizes the wire value structurally', () => {
    expect(agentPresetProjectionOf('standard')).toBe('standard')
    expect(agentPresetProjectionOf(null)).toBeNull()
    expect(agentPresetProjectionOf(undefined)).toBeUndefined()
    expect(agentPresetProjectionOf(7)).toBeUndefined()
    expect(agentPresetProjectionOf({ id: 'standard' })).toBeUndefined()
  })
})

describe('agentPresetRefusal', () => {
  it('reads the reason detail first, then the wrapped message', () => {
    expect(agentPresetRefusal({
      code: 'agent-preset/locked',
      message: 'session already started',
      details: { sessionId: 's1', reason: 'the conversation has started' },
    })).toBe('the conversation has started')
    expect(agentPresetRefusal({ code: 'x', message: 'wrapped message', details: { sessionId: 's1' } }))
      .toBe('wrapped message')
    expect(agentPresetRefusal({ code: 'x' })).toBe('x')
    expect(agentPresetRefusal({})).toBe('agent preset switch failed')
  })
})

describe('isBuiltInPreset (the native display-fold gate)', () => {
  it('names a shipped preset whose row publishes no name', () => {
    expect(isBuiltInPreset({ id: 'standard' })).toBe(true)
    expect(isBuiltInPreset({ id: 'ptc' })).toBe(true)
    expect(isBuiltInPreset({ id: 'minimal' })).toBe(true)
    expect(isBuiltInPreset({ id: 'cordis' })).toBe(true)
  })

  it('never translates a row that publishes its own name, even on a shipped id', () => {
    expect(isBuiltInPreset({ id: 'standard', name: 'My standard' })).toBe(false)
  })

  it('rejects ids the dictionaries carry no copy for', () => {
    expect(isBuiltInPreset({ id: 'custom-tool' })).toBe(false)
  })
})

describe('presetDisplayText (the native display fold, alpha.12 feedback #42)', () => {
  it('resolves the four shipped presets through the host dictionary', () => {
    expect(presetDisplayText({ id: 'standard' }, HOST_T)).toEqual({
      name: 'Standard mode',
      description: 'Work with code, files, and information.',
    })
    expect(presetDisplayText({ id: 'ptc' }, HOST_T)).toEqual({
      name: 'PTC mode',
      description: 'Batch tool calls, then filter and summarize.',
    })
    expect(presetDisplayText({ id: 'minimal' }, HOST_T)).toEqual({
      name: 'Minimal mode',
      description: 'Terminal tool only.',
    })
    expect(presetDisplayText({ id: 'cordis' }, HOST_T)).toEqual({
      name: 'Creator mode',
      description: 'Customize DSH through conversation.',
    })
  })

  it('keeps user-authored metadata untranslated even on a shipped id', () => {
    const text = presetDisplayText({ id: 'standard', name: 'My standard', description: 'mine' }, HOST_T)
    expect(text.name).toBe('My standard')
    expect(text.description).toBe('mine')
  })

  it('falls back to the roster row when the host dictionary is absent (the seat echoes the raw key)', () => {
    const text = presetDisplayText({ id: 'standard' }, (key) => key)
    expect(text.name).toBe('standard')
    expect(text.description).toBeUndefined()
  })

  it('resolves custom rows from their own data, describing nothing when none published', () => {
    const named = presetDisplayText(CORDIS, HOST_T)
    expect(named.name).toBe('Creator mode')
    expect(named.description).toBe('Build plugins by talking.')
    const bare = presetDisplayText({ id: 'mystery' }, HOST_T)
    expect(bare.name).toBe('mystery')
    expect(bare.description).toBeUndefined()
  })
})

describe('resolveAgentPresetCopy (host words first, plugin words as fallback)', () => {
  const own = {
    seatHint: 'Choose the agent preset for your new task',
    noDescription: 'No description.',
    switchRefused: 'Could not switch the agent preset: {reason}',
  }

  it('prefers the host dictionary when it resolves the keys', () => {
    expect(resolveAgentPresetCopy((key) => HOST_DICT[key] ?? key, own)).toEqual({
      seatHint: HOST_DICT['seatHint'],
      noDescription: HOST_DICT['noDescription'],
      switchRefused: HOST_DICT['switchRefused'],
    })
  })

  it('keeps the plugin words when the host namespace is absent (undefined seat or raw-key echo)', () => {
    expect(resolveAgentPresetCopy(undefined, own)).toEqual(own)
    expect(resolveAgentPresetCopy((key) => key, own)).toEqual(own)
  })

  it('hands the host refusal template through untouched — the face interpolates {name}', () => {
    expect(resolveAgentPresetCopy((key) => HOST_DICT[key] ?? key, own).switchRefused)
      .toBe('Could not switch to {name}: {reason}')
  })
})
