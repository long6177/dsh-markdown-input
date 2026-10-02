/**
 * The paint layer's dock occupant (`conversation.composer.dock`): an
 * invisible anchor that locates the composer's Lexical editor and runs the
 * L1 paint engine (paint-layer.ts) over it — the inline four colored,
 * syntax markers dimmed, via the CSS Custom Highlight API. The anchor sits
 * beside the composer card like the paste layer's, so the editor root is a
 * bounded ancestor walk away; until it appears (mount-order races) the dock
 * retries briefly and then logs the layer disabled.
 *
 * Everything degrades to the native composer: an unsupported browser never
 * attaches, a mid-life engine failure or the editor leaving the DOM latches
 * the layer off, and unmount stops the engine and clears every highlight.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { attachPaintLayer, paintCapability, type PaintHandle } from './paint-layer.ts'
import { composerEditorRoot } from './paste-layer.ts'

/** Bounded retry budget for the mount-order race with the composer editor. */
export const PAINT_ROOT_RETRIES = 50

/** How long one retry waits before re-resolving the editor root. */
export const PAINT_ROOT_RETRY_MS = 100

/**
 * The composer dock entry for the L1 paint layer.
 * @returns the invisible anchor element.
 */
export function PaintDock(): ReactNode {
  const anchorRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const capability = paintCapability()
    if (!capability.supported) {
      // Auto-disable: the host's native text face stays untouched for this
      // mount's life; a remount gets a fresh probe.
      console.info(`[markdown-input] paint layer disabled: ${capability.reason}`)
      return undefined
    }
    let handle: PaintHandle | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    let attempts = 0
    const attach = (): void => {
      if (cancelled || handle !== null) return
      const root = composerEditorRoot(anchorRef.current)
      if (root !== null) {
        handle = attachPaintLayer(root)
        return
      }
      attempts += 1
      if (attempts > PAINT_ROOT_RETRIES) {
        // Never a broken composer: without the editor the layer has no
        // surface and gives up for this mount.
        console.info('[markdown-input] paint layer disabled: composer editor not found')
        return
      }
      timer = setTimeout(attach, PAINT_ROOT_RETRY_MS)
    }
    attach()
    return () => {
      cancelled = true
      clearTimeout(timer)
      handle?.stop()
      handle = null
    }
  }, [])

  return <span ref={anchorRef} data-markdown-input-paint-anchor hidden aria-hidden="true" />
}
