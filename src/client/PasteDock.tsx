/**
 * The paste layer's dock occupant (`conversation.composer.dock`): a
 * session-scope peripheral entry that renders an invisible anchor and
 * handles rich-text paste for the native composer. Session scope grants
 * the host's stable `inputActions` face as a standard prop; the anchor
 * locates the composer's Lexical editor at paste time so only pastes into
 * that editor are judged.
 *
 * Every layer decision degrades to the native paste: the handler inserts
 * through the version-guarded face FIRST and cancels the event only after
 * the insertion landed, so a refused insertion (machine frozen, revision
 * moved) still pastes the host's way. Any surprise latches the layer off
 * for the page life instead of breaking the composer.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { killSwitch } from './capability.ts'
import {
  gestureListener, insertionCapability, pasteListener, plainPasteGestureTracker,
  type InsertionFace,
} from './paste-layer.ts'

/** The props one dock occupant receives (session standard props, unknown-shaped). */
export interface PasteDockProps {
  /** The host's stable per-session input action face (probed, never assumed). */
  readonly inputActions?: unknown
}

/**
 * The composer dock entry for the L3 paste layer.
 * @param props - session standard props; `inputActions` drives the layer.
 */
export function PasteDock({ inputActions }: PasteDockProps): ReactNode {
  const anchorRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const capability = insertionCapability(inputActions)
    if (!capability.supported) {
      // Auto-disable: rich pastes keep the host's own routing for the page life.
      console.info(`[markdown-input] paste layer disabled: ${capability.reason}`)
      return undefined
    }
    const face = inputActions as InsertionFace
    const gesture = plainPasteGestureTracker()
    const kill = killSwitch()
    const onKeyDown = gestureListener(gesture, kill)
    const onPaste = pasteListener(face, anchorRef, gesture, kill)
    // Capture on the document: these run before the host's Lexical paste
    // routing on the editor root, which is what the interception needs.
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('paste', onPaste, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('paste', onPaste, true)
    }
  }, [inputActions])

  return <span ref={anchorRef} data-markdown-input-paste-anchor hidden aria-hidden="true" />
}
