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
 *
 * The registry also carries the chain's settle contract (#36): the opener
 * receives the caller's {@link ChainPopupSettle} and the popup face invokes
 * it on a successful selection, so a chain opened from a typed trigger token
 * (`/mo` → model row) consumes that token and refocuses the editor exactly
 * like the host PopupSelectController.settle. The `+` menu's `query: ''`
 * chain has no draft token and passes nothing.
 */

/** Which second-layer popup face can be chain-opened. */
export type ChainPopupId = 'permission' | 'model'

/**
 * The settle hook of one chain open (issue #36): the caller that opened the
 * popup hands it over at open time, and the popup invokes it **exactly once,
 * only after a selection SUCCEEDS**. Its job is the host
 * `PopupSelectController.settle` tail — consume the draft trigger token the
 * chain was opened from (a text-level CAS that is silently benign on a miss)
 * and return focus to the editor. A dismissal (Escape / outside pointerdown)
 * and a failure never call it, and the popup face drops any hook it did not
 * consume when it closes, so a later direct pill pick can never settle a
 * stale token.
 */
export type ChainPopupSettle = () => void

type ChainOpener = (settle: ChainPopupSettle | undefined) => boolean

/** Page-lifetime registry; the browser half resets with the page. */
const openers = new Map<ChainPopupId, ChainOpener>()

/**
 * Register the opener of one popup face. Idempotent per id: the latest
 * registration wins and the returned disposer removes only its own.
 * @param id - which popup face the opener belongs to.
 * @param open - opens the popup; returns false when it cannot open right
 * now. It receives the caller's settle hook (undefined for a chain with no
 * draft token, e.g. the `+` menu) and must hold it for the popup's lifetime.
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
 * (pick settles first); a missing or declined opener reports false. The
 * optional settle hook rides to the opener and is forgotten with a decline:
 * the popup never held it, so nothing can consume it later.
 * @param id - which popup face.
 * @param settle - settle hook for a chain opened from a typed trigger token
 * (omit it for a chain with no draft token).
 * @returns whether the popup opened.
 */
export function openChainPopup(id: ChainPopupId, settle?: ChainPopupSettle): boolean {
  const open = openers.get(id)
  return open === undefined ? false : open(settle)
}

/**
 * Test seam: clear the registry so a fresh test sees fresh faces. Never
 * call in plugin code — the registry is page-lifetime by design.
 */
export function resetChainPopups(): void {
  openers.clear()
}
