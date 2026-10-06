/**
 * One trigger-anchored stat-dialog seat for the takeover card (issue #43's
 * third round, alpha.14 retest): the open state, the viewport-clamped
 * placement, and the dismissal wiring the dock's stat dialogs ride — vendored
 * from dsh `ui-chat/src/client/chat/stat-dialog.ts` (0.2.0-rc.2).
 *
 * The two primitives are the SAME seats the context meter's composition panel
 * already uses in ContextMeterFace (`useAnchoredPosition` side top, gap 8,
 * margin 12; `useDismissOnOutsidePointer` with the portaled panel counted as
 * inside) plus the local Escape listener; the meter keeps its own inline copy
 * untouched, and this helper exists for the pills' dialogs only.
 *
 * One deviation from the host hook, by construction: the controlled open
 * state is REQUIRED here. The host's optional uncontrolled arm serves the
 * TurnUsagePanel's per-turn dialog, which has no seat on the takeover card —
 * the card's only two dialogs are the stats pills', and both share the row's
 * one exclusive slot (`StatsPills.tsx:320-321` mirrored in StatsPillsFace).
 */
import { useEffect, useRef, type CSSProperties, type MutableRefObject } from 'react'
import { useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'

/** Viewport margin the placement clamp keeps (the Menu portal margin; host `stat-dialog.ts:9`). */
const PANEL_MARGIN = 12

/** Distance between the trigger's top edge and the panel's bottom (host `stat-dialog.ts:12`). */
const PANEL_GAP = 8

/**
 * Unplaced portal panel: hidden but laid out so the clamp measures real
 * dimensions (the `useAnchoredPosition` measure pass; host
 * `stat-dialog.ts:18`). Spread `pos ?? MEASURE_STYLE` onto the portaled panel.
 */
export const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** The open state one pill's dialog reads and writes (the row's exclusive slot). */
export type StatDialogSlot = Pick<StatDialogSeat, 'open' | 'setOpen'>

/** Open state, refs, and clamped placement for one stat dialog. */
export interface StatDialogSeat {
  open: boolean
  setOpen: (open: boolean) => void
  rootRef: MutableRefObject<HTMLSpanElement | null>
  panelRef: MutableRefObject<HTMLDivElement | null>
  pos: CSSProperties | null
}

/**
 * One trigger-anchored dialog seat: open state, viewport-clamped placement,
 * outside-close, Escape-close.
 * @param controlled - the external open state the row's exclusive slot owns;
 * the seat reads and writes it, so opening either pill closes the other.
 * @returns the seat; spread `pos ?? MEASURE_STYLE` onto the portaled panel.
 */
export function useStatDialog(controlled: StatDialogSlot): StatDialogSeat {
  const { open, setOpen } = controlled
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Portal placement: the dialog is fixed above the trigger and clamped inside
  // the viewport, so a trigger near the window edge cannot push it off-screen
  // (host stat-dialog.ts:44-51).
  const pos = useAnchoredPosition({
    open,
    anchorRef: rootRef,
    panelRef,
    side: 'top',
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  })

  // Outside pointerdown closes through the shared primitive; the portaled
  // panel counts as inside. Escape close stays local, one listener while open
  // (host stat-dialog.ts:55-63).
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, setOpen])

  return { open, setOpen, rootRef, panelRef, pos }
}
