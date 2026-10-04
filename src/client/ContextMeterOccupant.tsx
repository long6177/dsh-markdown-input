/**
 * The `conversation.composer.dock` occupant body of the context meter
 * (issue #43): resolves the component's two runtime seams — the session
 * standard `useProjection` seat the renderer injects into every session-scope
 * occupant, and the `conversation` translate seat apply binds — and mounts the
 * vendored meter (ContextMeterFace.tsx) for the rest of the work.
 *
 * The wrapper exists for the same reason the tool-row faces have one: a
 * renderer whose session standard kit never contributed `useProjection` (a
 * host build without ui-session's session standard source) hands this dock
 * occupant no hook to call, and calling an absent hook would crash the slot.
 * The guard renders NOTHING instead — the acceptance rule is that without the
 * projection there is no meter and no dead seat.
 */
import type { ReactNode } from 'react'
import { contextLocale } from './context-meter-face.ts'
import { ContextMeterFace, type ContextMeterFaceProps } from './ContextMeterFace.tsx'

/**
 * The dock occupant's incoming shape: the session kit's projection seat is
 * injected as a plain prop (`useProjection`), and its presence is the only
 * structural requirement — the meter itself decides visibility from the
 * projection values (both projections absent, or no capacity, render nothing).
 */
export interface ContextMeterOccupantProps {
  /** The session standard `useProjection` seat, absent on a host kit without it. */
  readonly useProjection?: ContextMeterFaceProps['useProjection'] | undefined
}

/**
 * The dock meter occupant.
 * @param props - the renderer-injected session props (owner props are empty:
 * the dock slot declares no owner share).
 * @returns the meter, or nothing while the projection seat or the copy is
 * unavailable.
 */
export function ContextMeterOccupant({ useProjection }: ContextMeterOccupantProps): ReactNode {
  // Read the bound translate seat per render (apply binds it at boot; the
  // binding is page-lifetime, so a render before apply has nothing to show).
  const t = contextLocale()
  if (typeof useProjection !== 'function' || t === undefined) return null
  return <ContextMeterFace useProjection={useProjection} t={t} />
}
