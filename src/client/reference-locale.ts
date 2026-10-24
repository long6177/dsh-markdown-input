/**
 * Copy bindings for the reference surfaces this plugin rebuilds (#75): the
 * file-open retry dialog's words (the host `reference` namespace's own
 * `fileOpen.*` keys — `ui-reference/src/client/locales.ts`) and the secret
 * reveal toggle's words (the host `secretMask` namespace's `secret.*` keys
 * — `ui-secret-mask/src/client/locales.ts`). Neither namespace is in this
 * build's merge table (ui-reference and ui-secret-mask are not plugin
 * dependencies), so the binds resolve through the untyped overload and are
 * narrowed to the keys each surface reads; the plugin's locales.ts ships
 * the host strings verbatim as fallbacks, so a dictionary miss (or an
 * unbound page-life) still speaks the native words.
 *
 * Both are read-only binds of namespaces the host plugins own and register
 * — the same posture as the stats pills' `chat` binding: a read, never a
 * claim. Binding is stable per namespace and reads the active locale at
 * call time, so a locale switch repaints both surfaces in the host's own
 * words.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { NS } from './locales.ts'

/** The host namespace the file-open dialog's copy lives in (ui-reference's locale NS). */
export const REFERENCE_NS = 'reference'
/** The host namespace the secret toggle's copy lives in (ui-secret-mask's locale NS). */
export const SECRET_MASK_NS = 'secretMask'
/** The plugin's own namespace — the summary line's fallback words live here. */
export const SUMMARY_FALLBACK_NS = NS

/** The keys the file-open dialog reads off the host `reference` namespace. */
export type ReferenceHostKey = 'fileOpen.title' | 'fileOpen.failed' | 'fileOpen.close' | 'fileOpen.retry'
/** The keys the secret toggle reads off the host `secretMask` namespace. */
export type SecretHostKey = 'secret.reveal' | 'secret.hide'
/** The keys the summary line reads off the host `chat` namespace (the seat's own). */
export type SummaryHostKey = 'message.referenceSummary' | 'message.referenceSeparator'

type HostTranslate = (key: string, params?: Record<string, unknown>) => string
/** The chat-node seat's translate, narrowed to the summary line's two keys. */
export type SummarySeatTranslate = (key: SummaryHostKey, params?: Record<string, unknown>) => string

let referenceT: HostTranslate | undefined
let secretT: HostTranslate | undefined
/** The plugin's own translate, narrowed to the summary line's fallback keys. */
let summaryT: ((key: SummaryHostKey, params?: Record<string, unknown>) => string) | undefined

/**
 * Bind the reference surfaces' translate seats (the client apply does this
 * once, beside the other namespace bindings).
 * @param t - the `reference` namespace translate.
 */
export function setReferenceLocale(t: HostTranslate): void {
  referenceT = t
}

/**
 * Bind the secret toggle's translate seat.
 * @param t - the `secretMask` namespace translate.
 */
export function setSecretLocale(t: HostTranslate): void {
  secretT = t
}

/**
 * The file-open dialog's copy: the host `reference` namespace's own words
 * through the bound seat, the plugin's verbatim fallback lines under a miss
 * (a bound translate answers a miss with the echoed key) or an unbound
 * namespace. The `resolveStatsCopy`/`resolveAddWorkspaceCopy` fold.
 */
export function fileOpenCopy(): {
  title: string
  failed(path: string): string
  close: string
  retry: string
} {
  const read = (key: ReferenceHostKey, fallback: string, params?: Record<string, unknown>): string => {
    const value = referenceT?.(key, params)
    return value === undefined || value === key ? fallback : value
  }
  return {
    get title() { return read('fileOpen.title', '无法打开文件') },
    failed(path: string): string {
      return read('fileOpen.failed', `无法打开“${path}”，请重试或关闭此提示`, { path })
    },
    get close() { return read('fileOpen.close', '关闭') },
    get retry() { return read('fileOpen.retry', '重试') },
  }
}

/**
 * The secret toggle's copy: the host `secretMask` namespace's own words
 * through the bound seat, the plugin's verbatim fallback lines under a miss
 * or an unbound namespace (the same fold as {@link fileOpenCopy}).
 */
export function secretToggleCopy(): { reveal: string, hide: string } {
  const read = (key: SecretHostKey, fallback: string): string => {
    const value = secretT?.(key)
    return value === undefined || value === key ? fallback : value
  }
  return {
    get reveal() { return read('secret.reveal', '显示密钥') },
    get hide() { return read('secret.hide', '隐藏密钥') },
  }
}

/**
 * The bubble's reference summary line copy (#75). The words are the host
 * `chat` namespace's own (`message.referenceSummary` /
 * `message.referenceSeparator` — ui-chat renders the same fold in its
 * UserContent), read first through the chat-node seat's translate; a miss
 * (the echoed key) or a seatless render falls back to the plugin's own
 * `markdown-input` dictionary — the host strings verbatim, localized by the
 * same active locale the bind reads — and finally to the zh literal.
 * @param seatT - the chat namespace translate the seat carries, if any.
 * @param labels - the node's reference labels, in appearance order.
 * @returns the line text (the labels already joined).
 */
export function referenceSummaryLineCopy(
  seatT: SummarySeatTranslate | undefined,
  labels: readonly string[],
): string {
  const read = (
    key: 'message.referenceSummary' | 'message.referenceSeparator',
    fallback: string,
    params?: Record<string, unknown>,
  ): string => {
    const host = seatT?.(key, params)
    if (host !== undefined && host !== key) return host
    const own = summaryT?.(key, params)
    return own !== undefined && own !== key ? own : fallback
  }
  const joined = labels.join(read('message.referenceSeparator', '、'))
  return read('message.referenceSummary', `引用会话 · ${joined}`, { labels: joined })
}

/**
 * Bind the summary fallback's translate seat (the client apply does this
 * once, beside the other namespace bindings — this one is the plugin's OWN
 * namespace, registered by the apply body).
 * @param t - the `markdown-input` namespace translate.
 */
export function setSummaryLocale(t: (key: SummaryHostKey, params?: Record<string, unknown>) => string): void {
  summaryT = t
}

/**
 * Install both bindings on the client root context (called once from the
 * plugin apply). Both namespaces are outside this build's merge table, so
 * the binds resolve through the untyped overload and the seats are narrowed
 * to the keys each surface reads.
 * @param ctx - client root context.
 */
export function installReferenceLocales(ctx: ClientContext): void {
  setReferenceLocale(ctx.locale.bind(REFERENCE_NS))
  setSecretLocale(ctx.locale.bind(SECRET_MASK_NS))
  setSummaryLocale(ctx.locale.bind(NS))
}

/**
 * Test seam: drop the bindings so a fresh test sees unbound namespaces.
 * Never call in plugin code — the bindings are page-lifetime by design.
 */
export function resetReferenceLocale(): void {
  referenceT = undefined
  secretT = undefined
  summaryT = undefined
}
