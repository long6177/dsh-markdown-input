/**
 * The stop view-model core (issue #32): when the takeover card shows Stop
 * and what the primary button names. The math mirrors the native InputBar
 * line-for-line (`primaryStops` / `interruptible`), so the tests pin the
 * native conditions, not an invention: an ordinary running session keeps
 * Stop while the composer is empty or owner-blocked; a continuable child
 * keeps Send primary and exposes Stop independently.
 */
import { describe, expect, it } from 'vitest'
import { dedicatedStopOf, primaryStopsOf } from '../src/client/stop-core.ts'

function conditions(overrides: Partial<Parameters<typeof primaryStopsOf>[0]> = {}) {
  return {
    running: true,
    subagent: null,
    empty: true,
    blocked: false,
    ...overrides,
  }
}

describe('primaryStopsOf (native primaryStops)', () => {
  it('stops on an ordinary running session with an empty composer', () => {
    expect(primaryStopsOf(conditions())).toBe(true)
  })

  it('keeps the busy send gesture while an actionable draft is typed', () => {
    expect(primaryStopsOf(conditions({ empty: false }))).toBe(false)
  })

  it('substitutes a raised owner block for the empty composer', () => {
    expect(primaryStopsOf(conditions({ empty: false, blocked: true }))).toBe(true)
  })

  it('never stops an idle session', () => {
    expect(primaryStopsOf(conditions({ running: false }))).toBe(false)
  })

  it('never turns the primary on a subagent-addressed session', () => {
    // A continuable child keeps Send primary (its Stop is the dedicated
    // button); any other address keeps the primary untouched too.
    expect(primaryStopsOf(conditions({
      subagent: { address: { mode: 'continuable' } },
    }))).toBe(false)
    expect(primaryStopsOf(conditions({
      empty: false,
      subagent: { address: { mode: 'supervised' } },
    }))).toBe(false)
  })

  it('reads an absent subagent field as an ordinary session', () => {
    // Native normalizes the selector result with `?? null`: a session
    // snapshot without the field cannot prove an address, so the ordinary
    // reading stands.
    expect(primaryStopsOf(conditions({ subagent: undefined }))).toBe(true)
  })
})

describe('dedicatedStopOf (native interruptible)', () => {
  it('exposes the dedicated Stop on a running continuable child', () => {
    expect(dedicatedStopOf(conditions({
      subagent: { address: { mode: 'continuable' } },
    }))).toBe(true)
  })

  it('keeps nothing dedicated on other address modes', () => {
    expect(dedicatedStopOf(conditions({
      subagent: { address: { mode: 'supervised' } },
    }))).toBe(false)
  })

  it('keeps nothing dedicated on an ordinary session', () => {
    expect(dedicatedStopOf(conditions())).toBe(false)
  })

  it('keeps nothing dedicated while idle', () => {
    expect(dedicatedStopOf(conditions({
      running: false,
      subagent: { address: { mode: 'continuable' } },
    }))).toBe(false)
  })
})
