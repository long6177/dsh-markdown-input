/**
 * Seam: the read-only view of the host `sessions` list snapshot (#75). The
 * `@` popup needs a session summary's origin/parent linkage (subagent
 * detection), its update time (the row's age), and its cwd (the file- and
 * skill-chip activations address paths with); the chat-node renderer side
 * has no standard seat, so the snapshot is consumed through a lazily
 * probed, per-call-read face — a host without the service (or without the
 * snapshot shape) degrades to `undefined` and every reader takes its own
 * fallback (all sessions under the plain section, ages from the candidate
 * creation time, cwd-less addresses).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hostHome, installSessionsSource, resetSessionsSource, sessionSnapshot,
} from '../src/client/sessions-face.ts'

afterEach(() => {
  resetSessionsSource()
})

describe('hostHome', () => {
  it('reads undefined while no source is bound', () => {
    expect(hostHome()).toBeUndefined()
  })

  it('reads the host facts home off the bare remote service', () => {
    installSessionsSource({
      get: (key: string) => (key === 'remote' ? { $host: { home: '/home/u' } } : undefined),
    } as never)
    expect(hostHome()).toBe('/home/u')
  })

  it('reads undefined when the facts carry no string home', () => {
    installSessionsSource({
      get: (key: string) => (key === 'remote' ? { $host: {} } : undefined),
    } as never)
    expect(hostHome()).toBeUndefined()
  })

  it('survives a throwing service read', () => {
    installSessionsSource({ get: () => { throw new Error('sealed') } } as never)
    expect(hostHome()).toBeUndefined()
  })
})

describe('sessionSnapshot', () => {
  it('reads undefined while no source is bound', () => {
    expect(sessionSnapshot()).toBeUndefined()
  })

  it('reads undefined when the host lacks the sessions service', () => {
    installSessionsSource({ get: () => undefined } as never)
    expect(sessionSnapshot()).toBeUndefined()
  })

  it('reads undefined when list carries no snapshot store', () => {
    installSessionsSource({ get: (key: string) => (key === 'sessions' ? { list: {} } : undefined) } as never)
    expect(sessionSnapshot()).toBeUndefined()
  })

  it('reads the byId map off the list snapshot', () => {
    const byId = { s1: { cwd: '/w', origin: 'subagent' } }
    installSessionsSource({
      get: (key: string) => (key === 'sessions' ? { list: { getSnapshot: () => ({ byId }) } } : undefined),
    } as never)
    expect(sessionSnapshot()).toEqual(byId)
  })

  it('survives a throwing service read (a render never throws into the card)', () => {
    installSessionsSource({ get: () => { throw new Error('sealed') } } as never)
    expect(sessionSnapshot()).toBeUndefined()
  })

  it('resolves per call so a service that materializes later is found', () => {
    let store: { list: { getSnapshot: () => { byId: Record<string, unknown> } } } | undefined
    installSessionsSource({ get: (key: string) => (key === 'sessions' ? store : undefined) } as never)
    expect(sessionSnapshot()).toBeUndefined()
    store = { list: { getSnapshot: () => ({ byId: { s1: { cwd: '/w' } } }) } }
    expect(sessionSnapshot()).toEqual({ s1: { cwd: '/w' } })
  })
})
