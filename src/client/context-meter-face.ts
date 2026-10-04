/**
 * The context meter's copy binding (issue #43): the meter's words are the HOST
 * `conversation` namespace's own dictionary keys — `context.aria`,
 * `context.used`, `context.system`, `context.tools`, `context.messages`, and
 * the shared compact-number templates `number.thousand` / `number.million`
 * (`ui-conversation/src/client/locales.ts`, zh and en both shipped by the
 * host). The plugin therefore registers NO dictionary for this face and
 * invents no copy: apply binds the `conversation` namespace once and the
 * component reads the bound seat at render time, exactly the `model-face.ts`
 * posture (bind reads the active locale at call time; the same idiom the host
 * apply uses for its own seats).
 *
 * The `conversation` namespace belongs to ui-conversation, which registers it
 * as part of its own plugin body, so binding here is a read, never a claim.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextTranslate } from './context-occupancy.ts'

/** The host namespace the meter's copy lives in (ui-conversation's locale NS). */
export const CONTEXT_NS = 'conversation'

let localeT: ContextTranslate | undefined

/**
 * Bind the meter's translate seat (the client apply does this once, beside the
 * model dictionary registration).
 * @param t - the `conversation` namespace translate seat.
 */
export function setContextLocale(t: TranslateNS<typeof CONTEXT_NS>): void {
  localeT = t
}

/**
 * The meter's translate seat, or undefined before apply binds it — the face
 * component renders nothing then (a host composition that never bound the
 * namespace has no copy to show, and the plugin ships no fallback copy).
 */
export function contextLocale(): ContextTranslate | undefined {
  return localeT
}

/**
 * Test seam: drop the binding so a fresh test sees an unbound face. Never call
 * in plugin code — the binding is page-lifetime by design.
 */
export function resetContextLocale(): void {
  localeT = undefined
}
