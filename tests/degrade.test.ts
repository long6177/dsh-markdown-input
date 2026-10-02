/**
 * Card-level degradation (ADR-0005 Q5): the session latch, the one-shot
 * notice event, and the unified `fallbackToNative` path — the funnel every
 * card-killing failure (boundary-caught crash, editor-face probe failure)
 * goes through: report on the console, latch once, announce once, hand off
 * to the bound action once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindComposerCrash, degradeTakeover, fallbackToNative, onTakeoverDegrade,
  resetTakeoverDegradation, takeDegradeNotice, takeoverDegraded,
} from '../src/client/degrade.ts'

afterEach(() => {
  resetTakeoverDegradation()
  bindComposerCrash(undefined)
  vi.restoreAllMocks()
})

describe('session latch', () => {
  it('starts unlatched', () => {
    expect(takeoverDegraded()).toBe(false)
    expect(takeDegradeNotice()).toBeNull()
  })

  it('latches once with the first reason and fires the notice event once', () => {
    const seen: string[] = []
    const unsubscribe = onTakeoverDegrade((event) => {
      seen.push(event.reason)
    })
    degradeTakeover('first failure')
    degradeTakeover('second failure')
    unsubscribe()
    expect(takeoverDegraded()).toBe(true)
    expect(seen).toEqual(['first failure'])
    // Live delivery consumed the notice: no mount-time catch-up remains.
    expect(takeDegradeNotice()).toBeNull()
  })

  it('a fallback with no live listener leaves the notice pending for the catch-up', () => {
    // The first-mount crash shape: the boundary reports during the commit,
    // before the notice dock's passive-effect subscription exists.
    degradeTakeover('editor face probe failed (setDraft missing)')
    expect(takeDegradeNotice()).toEqual({ reason: 'editor face probe failed (setDraft missing)' })
    // Consuming is one-shot: a remounting dock stays quiet.
    expect(takeDegradeNotice()).toBeNull()
  })

  it('a throwing listener does not block the others', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen: string[] = []
    onTakeoverDegrade(() => {
      throw new Error('bad listener')
    })
    onTakeoverDegrade((event) => {
      seen.push(event.reason)
    })
    expect(() => degradeTakeover('boom')).not.toThrow()
    expect(seen).toEqual(['boom'])
  })
})

describe('fallbackToNative', () => {
  it('reports the cause, latches, and fires the bound action', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const action = vi.fn()
    bindComposerCrash(action)
    const error = new Error('editor mount exploded')
    fallbackToNative('editor face mount failed', error, 'at Component')
    expect(consoleError.mock.calls.some(call => String(call[0]).includes('editor face mount failed'))).toBe(true)
    expect(consoleError.mock.calls.some(call => String(call[0]).includes('reverting to the native composer'))).toBe(true)
    expect(takeoverDegraded()).toBe(true)
    expect(action).toHaveBeenCalledWith(error)
  })

  it('is one-shot per page life: a second fallback neither re-latches nor re-fires', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const action = vi.fn()
    bindComposerCrash(action)
    const seen: string[] = []
    const unsubscribe = onTakeoverDegrade((event) => {
      seen.push(event.reason)
    })
    fallbackToNative('editor face probe failed (setDraft missing)')
    fallbackToNative('takeover card crashed')
    unsubscribe()
    expect(action).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['editor face probe failed (setDraft missing)'])
    // The report is not suppressed: every failure still names itself.
    expect(consoleError.mock.calls.filter(call => String(call[0]).includes('takeover card crashed')))
      .toHaveLength(1)
  })

  it('a failing fallback action is contained, not escalated', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    bindComposerCrash(() => {
      throw new Error('dispose exploded')
    })
    expect(() => fallbackToNative('editor face mount failed')).not.toThrow()
    expect(takeoverDegraded()).toBe(true)
    expect(consoleError.mock.calls.some(call => String(call[0]).includes('fallback action failed'))).toBe(true)
  })
})
