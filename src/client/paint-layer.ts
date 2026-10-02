/**
 * L1 paint layer skeleton (issue #15, ADR-0003): paint-only Markdown
 * rendering over the native composer text face — inline emphasis coloring
 * with dimmed syntax markers via the CSS Custom Highlight API. Zero DOM
 * change, no layout impact; the sent text stays the raw Markdown source.
 *
 * This ticket (#13) ships the degradation skeleton only: the capability
 * probe every paint entry point must consult. The engine (#15) owns a
 * killSwitch() from capability.ts for the latch-off-on-first-failure
 * behavior, since only the engine knows its entry points.
 */
import { probe, type Capability } from './capability.ts'

/**
 * Probe the CSS Custom Highlight API surface the paint layer draws with
 * (`Highlight` + `CSS.highlights`). Unsupported browsers get the native
 * composer, not a broken one.
 */
export function paintCapability(): Capability {
  return probe(
    () => typeof globalThis.Highlight === 'function'
      && typeof CSS !== 'undefined'
      && 'highlights' in CSS,
    'CSS Custom Highlight API unavailable',
  )
}
