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
  agentPresetProjectionOf, agentPresetRefusal, agentPresetSeatVisible,
  type AgentPresetOption,
} from '../src/client/agent-preset-core.ts'

const STANDARD: AgentPresetOption = { id: 'standard' }
const CORDIS: AgentPresetOption = { id: 'cordis', name: 'Creator mode', description: 'Build plugins by talking.' }

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
    expect(agentPresetMenuItems([STANDARD, CORDIS], 'No description.')).toEqual([
      { id: 'standard', label: 'standard', description: 'No description.' },
      { id: 'cordis', label: 'Creator mode', description: 'Build plugins by talking.' },
    ])
  })
})

describe('agentPresetDisplayName', () => {
  it('prefers the roster name, falling back to the id (the host fallback)', () => {
    expect(agentPresetDisplayName([STANDARD, CORDIS], 'cordis')).toBe('Creator mode')
    expect(agentPresetDisplayName([STANDARD, CORDIS], 'standard')).toBe('standard')
    expect(agentPresetDisplayName([STANDARD], undefined)).toBeUndefined()
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
