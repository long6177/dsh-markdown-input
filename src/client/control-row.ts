/**
 * Content-sized model collapse for the takeover card's tool row: collapse
 * the model pill's text only when the expanded controls cannot share a
 * line. Vendored from the host composer's `observeControlRow`
 * (ui-conversation/src/client/skeleton/control-row-layout.ts) — the
 * measurement algorithm is the truncation ladder's other half (the pill
 * shrinks its effort span first via flex, then the row's
 * `data-model-compact` attribute flips the pill to pure icon through the
 * `--dsh-composer-model-*-display` variables). Always measures EXPANDED
 * demand: the attribute is removed first, so a change while collapsed is
 * still seen.
 *
 * Two guards over the host original: a missing ResizeObserver (exotic
 * embeds, old jsdom) and a missing `document.fonts` degrade to the static
 * measure-and-leave instead of throwing into the card — a layout hint must
 * never be the thing that takes a face down.
 */

/** DOM faces the observer needs, narrow for tests. */
export interface ControlRow {
  readonly children: ArrayLike<Element>
  getBoundingClientRect(): { readonly width: number }
  toggleAttribute(name: string, force?: boolean): void
}

/** Read one computed CSS length as pixels, 0 when unparseable. */
function lengthOf(value: string): number {
  const length = parseFloat(value)
  return Number.isFinite(length) ? length : 0
}

/**
 * Observe one tool row and toggle `data-model-compact` whenever the
 * expanded controls' combined demand exceeds the row's content width.
 * @param row - the composer tool row with its controls as direct children.
 * @returns disconnect the observers and font listener.
 */
export function observeControlRow(row: ControlRow): () => void {
  const measure = (): void => {
    // The measurement is a layout hint: an exotic host missing the DOM
    // faces it reads leaves the row expanded (no attribute), never throws.
    try {
      row.toggleAttribute('data-model-compact', false)
      const style = getComputedStyle(row as Element)
      const available = row.getBoundingClientRect().width
        - lengthOf(style.paddingLeft) - lengthOf(style.paddingRight)
      const widths = Array.from(row.children, child => child.getBoundingClientRect().width)
        .filter(width => width > 0)
      const needed = widths.reduce((sum, width) => sum + width, 0)
        + Math.max(0, widths.length - 1) * lengthOf(style.columnGap)
      row.toggleAttribute('data-model-compact', needed > available)
    } catch { /* leave expanded */ }
  }
  const disposers: Array<() => void> = []
  // Each observer setup is its own capability check: an exotic host where
  // construction or observe throws degrades to the static measure, never a
  // composer effect crash.
  try {
    if (typeof ResizeObserver === 'function' && typeof getComputedStyle === 'function') {
      const resize = new ResizeObserver(measure)
      resize.observe(row as Element)
      for (const child of Array.from(row.children)) resize.observe(child)
      disposers.push(() => { resize.disconnect() })
    }
  } catch { /* static measure only */ }
  try {
    if (typeof MutationObserver === 'function') {
      const mutation = new MutationObserver(measure)
      mutation.observe(row as Element, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['hidden'],
      })
      disposers.push(() => { mutation.disconnect() })
    }
  } catch { /* static measure only */ }
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  fonts?.addEventListener?.('loadingdone', measure)
  disposers.push(() => { fonts?.removeEventListener?.('loadingdone', measure) })
  measure()
  return () => {
    for (const dispose of disposers) dispose()
  }
}
