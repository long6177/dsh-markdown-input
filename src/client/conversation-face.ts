/**
 * Gateway to the conversation service for the faces the composer chain
 * props do not carry: draft-attachment intake/display (the Conversation
 * controller owns the browser-side descriptors that `InputState.
 * attachmentIds` points at) and the per-session notice outlet (the same
 * store the resident bar renders). The state mutations themselves still
 * ride the public `inputActions` face; this module only supplies the
 * supporting reads and the File→draft registration.
 *
 * The face resolves lazily per call (boot order stays free) from the
 * client root context, mirroring how the host's own input hub reaches the
 * service. Runtime members beyond the published `IConversation` shape are
 * consumed through narrow structural types at the two cast sites below —
 * devDependencies pin the upstream master sources, and the slot/service
 * faces are per-version retest contract points (ADR-0002).
 */
import { useMemo, useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ComposerChainProps, ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Session id as the composer chain owner props declare it. */
export type SessionId = NonNullable<ComposerChainProps['sessionId']>

/** One surfaced input-machine notice (structurally: the facade's InputNotice). */
export interface ComposerNotice {
  readonly level: 'info' | 'error'
  readonly text: string
  readonly seq: number
}

/** Bare observable snapshot source (the dsh-client-store store shape). */
export interface ObservableSource<T> {
  subscribe(listener: () => void): () => void
  getSnapshot(): T
}

/** The input hub's per-session shell as its runtime face exposes it. */
type InputHubFace = ConversationController['input'] & {
  shell(sessionId: SessionId): { readonly notices: ObservableSource<ComposerNotice | null> }
}

/** The conversation service face the taken-over composer consumes. */
export type ConversationFace = ConversationController

export type ConversationSource = () => ConversationFace | undefined

let source: ConversationSource = () => undefined

/**
 * Bind the conversation service source (the client apply does this once;
 * the thunk resolves per call so plugin boot order stays free).
 * @param resolve - lazy face resolver.
 */
export function setConversationSource(resolve: ConversationSource): void {
  source = resolve
}

/**
 * The conversation service, or undefined while the host has not composed
 * it (attachment and notice surfaces degrade away, text stays functional).
 */
export function conversationFace(): ConversationFace | undefined {
  return source()
}

/**
 * The per-session notice outlet: the store the resident bar renders
 * errors as transient banners and information inline.
 * @param conversation - the conversation service face.
 * @param sessionId - owning session.
 */
export function noticesOf(
  conversation: ConversationFace,
  sessionId: SessionId,
): ObservableSource<ComposerNotice | null> {
  return (conversation.input as InputHubFace).shell(sessionId).notices
}

/**
 * Subscribe a component to a bare snapshot source (React 18's
 * useSyncExternalStore; the closures are captured per source so no
 * resubscription churn). Undefined sources read as undefined.
 * @param source - observable to bind, if the face is present.
 * @returns the current snapshot.
 */
export function useObservable<T>(source: ObservableSource<T> | undefined): T | undefined {
  const bound = useMemo(
    () => source === undefined
      ? { subscribe: () => () => {}, getSnapshot: (): T | undefined => undefined }
      : {
        subscribe: (listener: () => void) => source.subscribe(listener),
        getSnapshot: () => source.getSnapshot(),
      },
    [source],
  )
  return useSyncExternalStore(bound.subscribe, bound.getSnapshot)
}

/**
 * Install the gateway on the client root context (called once from the
 * plugin apply).
 * @param ctx - client root context.
 */
export function installConversationSource(ctx: ClientContext): void {
  setConversationSource(() => ctx.get('conversation') as ConversationController | undefined)
}
