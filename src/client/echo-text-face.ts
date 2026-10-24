/**
 * Copy binding for the submission-echo text entry (#77): the keyed
 * `conversation.user.text.node` `text` shadow renders the local echo's
 * plain text run through the same Markdown projection its durable bubble
 * uses — send a message and the echo that appears on submit is the bubble
 * that admits, no style jump. The echo entry lives on the host's
 * `conversation.user.text` factory, whose occurrences receive no locale
 * seat, so the chrome labels (fence toolbar copy, footnotes) resolve
 * through a bound host translate — the same posture as the stats pills'
 * `chat` binding, an independent seam so an unbound page-life (a host
 * without the chat dictionary) degrades the echo to the native plain run
 * and nothing else.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** The host namespace the echo chrome's labels live in (ui-chat's locale NS). */
export const ECHO_TEXT_NS = 'chat'

let localeT: TranslateNS<typeof ECHO_TEXT_NS> | undefined

/**
 * Bind the echo entry's translate seat (the client apply does this once,
 * beside the other namespace bindings). The `chat` namespace belongs to
 * ui-chat, which registers it as part of its own plugin body, so binding
 * here is a read, never a claim.
 * @param t - the `chat` namespace translate.
 */
export function setEchoLocale(t: TranslateNS<typeof ECHO_TEXT_NS>): void {
  localeT = t
}

/**
 * The echo entry's translate seat, or undefined before apply binds it — the
 * entry then renders the host's plain text run (the native echo), never raw
 * keys.
 */
export function echoLocale(): TranslateNS<typeof ECHO_TEXT_NS> | undefined {
  return localeT
}

/**
 * Test seam: drop the binding so a fresh test sees an unbound face. Never call
 * in plugin code — the binding is page-lifetime by design.
 */
export function resetEchoLocale(): void {
  localeT = undefined
}
