/**
 * Capability probing and auto-disable for the enhancement layers (ADR-0003).
 *
 * Every layer probes its host surface before activating and latches itself
 * off on first failure, so a probe miss or a mid-life exception degrades
 * that one layer back to the native host behavior — never the whole plugin,
 * and never the composer the host already renders natively.
 */

/** Verdict of one capability probe. */
export interface Capability {
  readonly supported: boolean
  /** What the probe missed; absent while supported. Diagnostics only. */
  readonly reason?: string
}

/**
 * Run one probe body. A throw inside the probe (sealed globals, exotic host
 * builds) is itself a failed verdict, not a plugin crash — probing must be
 * the safest thing a layer does.
 * @param body - feature check; return true when the surface is present.
 * @param reason - failure text reported when the body answers false.
 */
export function probe(body: () => boolean, reason: string): Capability {
  try {
    return body() ? { supported: true } : { supported: false, reason }
  } catch (error: unknown) {
    const detail = error instanceof Error ? ` (${error.message})` : ''
    return { supported: false, reason: `${reason}${detail}` }
  }
}

/** One-way disable latch shared by the layers' live entry points. */
export interface KillSwitch {
  /** Latch the layer off; later calls keep the first reason. */
  disable(reason: string): void
  /** Whether the layer has latched off. */
  readonly disabled: boolean
  /** Why the layer latched off; absent while still enabled. */
  readonly reason: string | undefined
}

/**
 * A latching disable flag for one layer. The latch is irreversible by
 * design — a flapping layer (works, crashes, works, crashes) is worse than
 * a quiet one, and the host-native behavior it degrades to is always
 * correct. Entry points read `disabled` before doing work and wrap their
 * body in a try/catch that calls `disable` on the first throw.
 */
export function killSwitch(): KillSwitch {
  const state = { disabled: false, reason: undefined as string | undefined }
  return {
    get disabled(): boolean {
      return state.disabled
    },
    get reason(): string | undefined {
      return state.reason
    },
    disable(reason: string): void {
      if (!state.disabled) {
        state.disabled = true
        state.reason = reason
      }
    },
  }
}
