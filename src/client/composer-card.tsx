/**
 * Card-level crash containment for the takeover card (ADR-0005): a render
 * exception anywhere inside the Markdown composer must never take the
 * host's conversation shell down with it — that failure mode is what
 * retired v1. The boundary swallows the frame (a silent null render),
 * reports the reason on the console, and fires the crash callback the
 * registrant installed — disposing the `conversation.composer` chain entry
 * so the election collapses and the native composer (the chain's overlay
 * fallback) tops back in. The composer body's own unmount flush mirrors the
 * text into the machine draft, so nothing the user typed is lost.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { MarkdownComposer, type MarkdownComposerProps } from './MarkdownComposer.tsx'

let crashHandler: ((error: unknown) => void) | undefined

/**
 * Install the card-crash callback (the plugin apply wires it to disposing
 * the composer chain entry). The latest installation wins; pass no handler
 * to clear.
 * @param handler - called for every caught render error.
 */
export function bindComposerCrash(handler: ((error: unknown) => void) | undefined): void {
  crashHandler = handler
}

interface ComposerCardState {
  readonly crashed: boolean
}

/**
 * Error boundary wrapping the taken-over composer body. Registration-latch
 * semantics: after a catch the entry disposes and this component unmounts
 * with the election; the null render only covers the frames in between.
 */
export class ComposerCard extends Component<{ children: ReactNode }, ComposerCardState> {
  override state: ComposerCardState = { crashed: false }

  static getDerivedStateFromError(): ComposerCardState {
    return { crashed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[markdown-input] takeover card crashed; reverting to the native composer',
      error, info.componentStack)
    try {
      crashHandler?.(error)
    } catch (handlerError: unknown) {
      // A failing handler must not escalate into the boundary again.
      console.error('[markdown-input] composer crash handler failed', handlerError)
    }
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children
  }
}

/**
 * The takeover card as one chain component: the composer body inside its
 * crash boundary. This is what the `conversation.composer` entry registers.
 * @param props - chain election marker plus standard session input props and copy.
 * @returns the boundary-wrapped composer card.
 */
export function TakeoverCard(props: MarkdownComposerProps): ReactNode {
  return (
    <ComposerCard>
      <MarkdownComposer {...props} />
    </ComposerCard>
  )
}
