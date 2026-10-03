/**
 * The chain-open registry between the `+` command menu (tool row ①) and the
 * second-layer popup faces (tool rows ② ③). The host chains the
 * permission/model menu rows into its popupSelect cards through a
 * per-session PopupSelectController; this plugin's popups are independent
 * gated faces, so the menu discovers them through a page-lifetime opener
 * registry instead: each popup face registers its opener while it is alive
 * (mounted, probe-met, rendering UI), and the menu row is available exactly
 * while an opener is registered — a degraded popup face hides its menu row,
 * never breaks the menu. The opener itself re-checks liveness at call time
 * (mount-transient states like a still-loading catalog decline the open).
 */

/** Which second-layer popup face can be chain-opened. */
export type ChainPopupId = 'permission' | 'model'

type ChainOpener = () => boolean

/** Page-lifetime registry; the browser half resets with the page. */
const openers = new Map<ChainPopupId, ChainOpener>()

/**
 * Register the opener of one popup face. Idempotent per id: the latest
 * registration wins and the returned disposer removes only its own.
 * @param id - which popup face the opener belongs to.
 * @param open - opens the popup; returns false when it cannot open right now.
 * @returns unregister.
 */
export function registerChainPopup(id: ChainPopupId, open: ChainOpener): () => void {
  openers.set(id, open)
  return () => {
    if (openers.get(id) === open) openers.delete(id)
  }
}

/**
 * Whether a live opener is registered — the command menu's availability
 * check for a chainable row.
 * @param id - which popup face.
 */
export function hasChainPopup(id: ChainPopupId): boolean {
  return openers.has(id)
}

/**
 * Chain-open a popup face. Closing the command menu is the caller's move
 * (pick settles first); a missing or declined opener reports false.
 * @param id - which popup face.
 * @returns whether the popup opened.
 */
export function openChainPopup(id: ChainPopupId): boolean {
  const open = openers.get(id)
  return open === undefined ? false : open()
}

/**
 * Test seam: clear the registry so a fresh test sees fresh faces. Never
 * call in plugin code — the registry is page-lifetime by design.
 */
export function resetChainPopups(): void {
  openers.clear()
}
