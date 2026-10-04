/**
 * Seam: the chain-open registry between the `+` command menu (tool row ①)
 * and the second-layer popup faces (tool rows ② ③). The host chains the
 * permission/model menu rows into its own popupSelect cards through a
 * per-session PopupSelectController; this plugin's popups are independent
 * gated faces, so the menu discovers them through a page-lifetime opener
 * registry instead: each popup face registers its opener while it is alive
 * (mounted, probe-met, rendering UI), and the menu row is available exactly
 * while an opener is registered — a degraded popup face hides its menu row,
 * never breaks the menu. The opener also receives the caller's settle hook
 * (#36): the popup face invokes it on a successful selection so a chain
 * opened from a typed trigger token consumes that token and refocuses the
 * editor; a chain with no draft token (the `+` menu) passes nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  hasChainPopup, openChainPopup, registerChainPopup, resetChainPopups,
  type ChainPopupSettle,
} from '../src/client/chain-open.ts'

describe('chain-open registry', () => {
  it('reports no opener before one registers', () => {
    resetChainPopups()
    expect(hasChainPopup('permission')).toBe(false)
    expect(openChainPopup('permission')).toBe(false)
  })

  it('registers an opener, reports availability, and opens through it', () => {
    resetChainPopups()
    let opened = 0
    const unregister = registerChainPopup('permission', () => { opened += 1; return true })
    expect(hasChainPopup('permission')).toBe(true)
    expect(openChainPopup('permission')).toBe(true)
    expect(opened).toBe(1)
    unregister()
    expect(hasChainPopup('permission')).toBe(false)
  })

  it('propagates a declined open (popup alive but not openable)', () => {
    resetChainPopups()
    registerChainPopup('model', () => false)
    expect(hasChainPopup('model')).toBe(true)
    expect(openChainPopup('model')).toBe(false)
  })

  it('the latest registration for an id wins; unregistration removes only its own', () => {
    resetChainPopups()
    let which = 'first'
    const unregisterFirst = registerChainPopup('model', () => { which = 'first'; return true })
    const unregisterSecond = registerChainPopup('model', () => { which = 'second'; return true })
    unregisterFirst()
    expect(openChainPopup('model')).toBe(true)
    expect(which).toBe('second')
    unregisterSecond()
    expect(hasChainPopup('model')).toBe(false)
  })
})

describe('chain-open settle hook (#36)', () => {
  it('hands the caller\'s settle hook to the opener, and nothing when no token is involved', () => {
    resetChainPopups()
    const seen: Array<ChainPopupSettle | undefined> = []
    registerChainPopup('model', (settle) => { seen.push(settle); return true })
    const settle = vi.fn()
    expect(openChainPopup('model', settle)).toBe(true)
    // The `+` menu's `query: ''` chain carries no draft token.
    expect(openChainPopup('model')).toBe(true)
    expect(seen).toEqual([settle, undefined])
  })

  it('a declined open reports false and nothing held the hook', () => {
    resetChainPopups()
    let received: ChainPopupSettle | undefined
    registerChainPopup('model', (settle) => { received = settle; return false })
    const settle = vi.fn()
    expect(openChainPopup('model', settle)).toBe(false)
    // The opener saw it but declined: the popup never took it over, so the
    // caller's span snapshot dies with the declined call.
    expect(received).toBe(settle)
    expect(settle).not.toHaveBeenCalled()
  })

  it('a missing opener drops the hook with the false verdict', () => {
    resetChainPopups()
    expect(openChainPopup('permission', vi.fn())).toBe(false)
  })
})
