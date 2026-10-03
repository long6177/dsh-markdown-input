/**
 * Capability probing for the card's faces (ADR-0005 hardening #2).
 *
 * Every face probes its host surface before activating, so a probe miss
 * degrades that one face back to the native host behavior — never the whole
 * plugin, and never the composer the host already renders natively.
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
 * the safest thing a face does.
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
