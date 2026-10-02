/**
 * Card-level crash containment for the takeover card (ADR-0005): a render
 * exception anywhere inside the Markdown composer must never take the
 * host's conversation shell down with it — that failure mode is what
 * retired v1. The boundary swallows the frame (a silent null render) and
 * funnels the crash into the unified card fallback (degrade.ts), which
 * reports the reason, latches the takeover off for the page life, fires
 * the one-shot notice, and disposes the `conversation.composer` chain
 * entry so the election collapses and the native composer (the chain's
 * overlay fallback) tops back in. The composer body's own unmount flush
 * mirrors the text into the machine draft, so nothing the user typed is
 * lost. The editor face's probe failure (MarkdownComposer) rides the same
 * fallback without the boundary.
 */
import { Component, type ReactNode } from 'react'
import { fallbackToNative } from './degrade.ts'
import { MarkdownComposer, type MarkdownComposerProps } from './MarkdownComposer.tsx'

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

  override componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    fallbackToNative('takeover card crashed', error, info.componentStack)
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
