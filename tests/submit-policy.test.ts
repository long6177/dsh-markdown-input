/**
 * The submission policy core (issue #79): the pure decision layer between
 * the host's busy-Enter preference, the session's busy/steerability
 * signals, and the delivery gestures (plain Enter/button, accelerated
 * chord, empty-draft whole-queue steer). Mirrors the pinned upstream
 * `resolveSubmitMode` formula; every signal here is a real wire field —
 * no invented inputs.
 */
import { describe, expect, it, afterEach } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  DEFAULT_BUSY_ENTER, busyEnterOf, busyEnterStore, canSteerQueueOf, installBusyEnterSource,
  primarySubmitLabelOf, resetBusyEnterSource, resolveSubmitMode, steeringAvailableOf,
} from '../src/client/submit-policy.ts'

describe('resolveSubmitMode (issue #79 AC1/AC3)', () => {
  it('queues whenever the session is not running, whatever the preference', () => {
    expect(resolveSubmitMode('steer', false, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('steer', false, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('queue', false, 'enter', true)).toBe('queue')
  })

  it('queues whenever steering is unavailable, whatever the preference', () => {
    expect(resolveSubmitMode('steer', true, 'enter', false)).toBe('queue')
    expect(resolveSubmitMode('steer', true, 'accelerated', false)).toBe('queue')
  })

  it('delivers the preference itself on plain Enter (and the button)', () => {
    expect(resolveSubmitMode('steer', true, 'enter', true)).toBe('steer')
    expect(resolveSubmitMode('queue', true, 'enter', true)).toBe('queue')
  })

  it('inverts the preference on the accelerated chord (upstream parity)', () => {
    expect(resolveSubmitMode('queue', true, 'accelerated', true)).toBe('steer')
    expect(resolveSubmitMode('steer', true, 'accelerated', true)).toBe('queue')
  })
})

describe('steeringAvailableOf (issue #79: real wire signal, `?? null` normalization)', () => {
  it('reads an unaddressed session as steerable', () => {
    expect(steeringAvailableOf(null)).toBe(true)
  })

  it('reads an absent subagent field as an ordinary session (stop-core normalization)', () => {
    expect(steeringAvailableOf(undefined)).toBe(true)
  })

  it('reads a continuable child address as steerable', () => {
    expect(steeringAvailableOf({ address: { mode: 'continuable' } })).toBe(true)
  })

  it('reads any other address mode as not steerable', () => {
    expect(steeringAvailableOf({ address: { mode: 'supervised' } })).toBe(false)
    expect(steeringAvailableOf({ address: { mode: 'detached' } })).toBe(false)
  })
})

describe('busyEnterOf (issue #79 AC1: the ui-conversation preference, default queue)', () => {
  it('accepts the two wire values', () => {
    expect(busyEnterOf({ value: { busyEnter: 'steer' } })).toBe('steer')
    expect(busyEnterOf({ value: { busyEnter: 'queue' } })).toBe('queue')
  })

  it('falls back to the native default on an absent snapshot, section, or malformed field', () => {
    expect(DEFAULT_BUSY_ENTER).toBe('queue')
    expect(busyEnterOf(undefined)).toBe('queue')
    expect(busyEnterOf({})).toBe('queue')
    expect(busyEnterOf({ value: undefined })).toBe('queue')
    expect(busyEnterOf({ value: { busyEnter: 'blast' } })).toBe('queue')
  })
})

describe('canSteerQueueOf (issue #79 AC3/AC4: the whole-queue steer gate, placeholder parity)', () => {
  const gate = {
    sessionBound: true,
    phase: 'plain' as const,
    draftEmpty: true,
    running: true,
    steeringAvailable: true,
    menuOpen: false,
    hasQueuedRows: true,
  }

  it('opens only with every arm on', () => {
    expect(canSteerQueueOf(gate)).toBe(true)
  })

  it('closes per arm', () => {
    expect(canSteerQueueOf({ ...gate, sessionBound: false })).toBe(false)
    expect(canSteerQueueOf({ ...gate, running: false })).toBe(false)
    expect(canSteerQueueOf({ ...gate, steeringAvailable: false })).toBe(false)
    expect(canSteerQueueOf({ ...gate, draftEmpty: false })).toBe(false)
    expect(canSteerQueueOf({ ...gate, menuOpen: true })).toBe(false)
    expect(canSteerQueueOf({ ...gate, hasQueuedRows: false })).toBe(false)
    for (const phase of ['adjudicating', 'submitting'] as const) {
      expect(canSteerQueueOf({ ...gate, phase })).toBe(false)
    }
  })

  it('stays open in the claimed phase (claim args are ordinary text)', () => {
    expect(canSteerQueueOf({ ...gate, phase: 'claimed' })).toBe(true)
  })
})

describe('primarySubmitLabelOf (issue #79 AC2: the label names the mode it delivers)', () => {
  it('names stop while the stop arm holds', () => {
    expect(primarySubmitLabelOf({
      primaryStops: true, running: true, steeringAvailable: true, enabled: true,
      plainMessageDraft: false, submitMode: 'queue',
    })).toBe('stop')
  })

  it('names the resolved mode on an enabled plain-message draft over a running steerable session', () => {
    const base = {
      primaryStops: false, running: true, steeringAvailable: true, enabled: true,
      plainMessageDraft: true,
    }
    expect(primarySubmitLabelOf({ ...base, submitMode: 'queue' })).toBe('send.queue')
    expect(primarySubmitLabelOf({ ...base, submitMode: 'steer' })).toBe('send.steer')
  })

  it('keeps plain send outside the mode arms', () => {
    const base = {
      primaryStops: false, running: true, steeringAvailable: true, enabled: true,
      plainMessageDraft: true, submitMode: 'queue' as const,
    }
    expect(primarySubmitLabelOf({ ...base, running: false })).toBe('send')
    expect(primarySubmitLabelOf({ ...base, steeringAvailable: false })).toBe('send')
    expect(primarySubmitLabelOf({ ...base, enabled: false })).toBe('send')
    expect(primarySubmitLabelOf({ ...base, plainMessageDraft: false })).toBe('send')
  })
})

describe('busyEnter settings face (issue #79 AC1: configForms `ui-conversation` probe)', () => {
  afterEach(() => { resetBusyEnterSource() })

  function formWith(busyEnter: unknown): unknown {
    const snapshot = { value: { busyEnter } }
    return {
      subscribe: (_listener: () => void) => () => {},
      getSnapshot: () => snapshot,
    }
  }

  it('resolves the ui-conversation form when the configForms service carries it', () => {
    const form = formWith('steer')
    installBusyEnterSource({
      get: (name: string) => name === 'configForms'
        ? { get: (namespace: string) => namespace === 'ui-conversation' ? form : undefined }
        : undefined,
    } as unknown as ClientContext)
    expect(busyEnterStore()).toBe(form)
    expect(busyEnterOf(busyEnterStore()?.getSnapshot())).toBe('steer')
  })

  it('reads as absent without the service, the form, or the store face', () => {
    installBusyEnterSource({ get: () => undefined } as unknown as ClientContext)
    expect(busyEnterStore()).toBeUndefined()
    installBusyEnterSource(undefined as unknown as ClientContext)
    expect(busyEnterStore()).toBeUndefined()
    installBusyEnterSource({
      get: (name: string) => name === 'ui-conversation' ? { getSnapshot: 'no' } : undefined,
    } as unknown as ClientContext)
    expect(busyEnterStore()).toBeUndefined()
  })

  it('a throwing ctx.get reads as absent — a render must never throw into the card', () => {
    installBusyEnterSource({
      get: () => { throw new Error('service not composed') },
    } as unknown as ClientContext)
    expect(busyEnterStore()).toBeUndefined()
  })
})
