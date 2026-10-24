/**
 * Markdown-rendered user messages: the `conversation.chat.node` `user` and
 * `steering` seat replacement. Composes the host baseline Markdown pipeline
 * (`MarkdownText`) with the vendored sent-text projection
 * (`user-text-projection.tsx`) — reference chips stay chips, the surrounding
 * text renders as Markdown. Known v1 trade-off: a chip inside a running
 * paragraph splits that paragraph into blocks around the chip; boundary
 * chips (the common cases) read seamlessly.
 *
 * Why a vendored projection instead of the host's `conversation.user.text`
 * factory: upstream 0.2.1-rc.2 removed `projectUserText` and moved reference
 * recognition into a host data-layer rule registry that, at rc.2, only knows
 * session and whitespace rules — adopting the host pipeline would silently
 * drop the `@file` / `/skill` inline chips. The vendored grammar (rc.0
 * `projectUserText`) renders over the still-public `UserTextRun` /
 * `ReferenceChip` primitives; retire it if the host's rules grow file/skill
 * recognition.
 */
import { Children, Fragment, isValidElement, memo, useMemo, type ReactNode } from 'react'
import {
  JsonBlock, MarkdownText, ReferenceChip, UserTextRun,
  type MarkdownLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ChatNodeViewProps, UserContentAttachment, UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { MessageActions } from './MessageActions.tsx'
import { hardenSoftBreaks } from './user-markdown.ts'
import { projectUserText } from './user-text-projection.tsx'
import css from './UserMessage.module.css'

/** Raw image block of a user message, typed as the host's own fold does. */
type UserImageBlock = Extract<UserMessageNode['content'][number], { type: 'image' }>

/** Chat-node seats this renderer replaces; the host serves both with one view. */
export type MarkdownSeatKind = 'user' | 'steering'

/** Chat-seat copy for the Markdown chrome (same keys the host passes down). */
function markdownLabels(t: ChatNodeViewProps<MarkdownSeatKind>['t']): MarkdownLabels {
  return {
    code: {
      copyLabel: t('copy'),
      copiedLabel: t('copied'),
      // The fence toolbar's own labels (#77): without them CodeBlock sheds
      // the card + wrap/unwrap toggle and falls back to the bare copy
      // banner. Same `chat` keys the host's markdown-labels fold uses.
      toolbarLabels: {
        codeLabel: t('codeBlock.title'),
        wrapLabel: t('codeBlock.wrap'),
        unwrapLabel: t('codeBlock.unwrap'),
      },
    },
    footnotes: t('markdown.footnotes'),
  }
}

/** Is this projected piece a reference chip (vs a plain text run)? */
function isChip(piece: ReactNode): boolean {
  return isValidElement(piece) && piece.type === ReferenceChip
}

/** Plain-run text sits directly inside the projection's run elements. */
function runText(piece: ReactNode): string {
  return isValidElement(piece) && piece.type === UserTextRun && typeof piece.props.text === 'string'
    ? piece.props.text
    : ''
}

/**
 * Project the message text: chips inline, everything else through the host
 * Markdown pipeline. Chips come from the vendored projection unchanged;
 * plain runs merge back into Markdown documents per contiguous span. Both
 * paths render through `hardenSoftBreaks` so the lines the author typed stay
 * visible in the bubble (GFM would fold a continuation line into a space).
 */
export function composeUserMarkdown(
  text: string,
  labels: MarkdownLabels,
  referenceLabels: readonly string[],
  skillNames: readonly string[],
): ReactNode {
  if (text === '') return null
  const projected = projectUserText(text, referenceLabels, skillNames)
  const pieces = Children.toArray(
    isValidElement(projected) && projected.type === Fragment ? projected.props.children : [projected],
  )
  if (!pieces.some(isChip)) return <MarkdownText text={hardenSoftBreaks(text)} labels={labels} />

  const out: ReactNode[] = []
  let run: string[] = []
  const flush = (): void => {
    if (run.length > 0) {
      const source = run.join('')
      if (source.trim() !== '') out.push(<MarkdownText key={out.length} text={hardenSoftBreaks(source)} labels={labels} />)
      run = []
    }
  }
  for (const piece of pieces) {
    if (isChip(piece)) {
      flush()
      // Array children need keys; the composition is static per message.
      out.push(<Fragment key={out.length}>{piece}</Fragment>)
    } else {
      run.push(runText(piece))
    }
  }
  flush()
  return out
}

/** One content block of a user message, read structurally (wire data). */
interface ContentBlock {
  readonly type?: string
  readonly text?: string
  readonly attachment?: unknown
}

/**
 * Split content blocks into joined text, the ordered attachment payload, and
 * the rest — the host `MessageItem.contentParts` fold verbatim. ONE pass in
 * wire order: images and files interleave into `attachments` exactly as the
 * author sent them (#77 — the previous images/files split reordered them),
 * and the all-attachment count is what drives the host's compact tile rule
 * (one image + one file tiles like two images). A typed block without its
 wire reference is not trusted as a card: it parks in `rest` like the
 * host's own fold.
 */
export function contentParts(content: readonly unknown[]): {
  text: string
  attachments: readonly UserContentAttachment[]
  rest: readonly unknown[]
} {
  const texts: string[] = []
  const attachments: UserContentAttachment[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as ContentBlock
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      attachments.push({ type: 'image', image: { attachment: (block as UserImageBlock).attachment } })
    } else if (b.type === 'file' && b.attachment !== undefined) {
      attachments.push({ type: 'file', file: b.attachment })
    } else rest.push(block)
  }
  return { text: texts.join(''), attachments, rest }
}

/**
 * The Markdown-rendered user message bubble. The host serves both the `user`
 * and `steering` keys with one component (identical node data), and so do we.
 * @param props - keyed chat renderer seat for the `user`/`steering` node kinds.
 * @returns the right-aligned bubble with attachments, Markdown text, and chips.
 */
export const MarkdownUserMessage = memo(function MarkdownUserMessage({
  node, loadImage, renderFactorySlot, t,
}: ChatNodeViewProps<MarkdownSeatKind>) {
  const data = node.data
  const { text, attachments, rest } = contentParts(data.content)
  // Stable per locale revision: a fresh object identity would rebuild
  // MarkdownText's caches per render (host parity).
  const labels = useMemo(() => markdownLabels(t), [t])
  const referenceLabels = data.referenceLabels ?? []
  const skillNames = data.skillNames ?? []
  return (
    <div className={css.row} data-markdown-user-message>
      <div className={css.stack}>
        {attachments.length > 0 && renderFactorySlot('conversation.chat.user.content', {
          // All attachments in wire order, text-less payload: the text keeps
          // rendering in this seat's Markdown bubble, the factory occurrence
          // renders just the native attachment row — images dispatch the
          // shipped `conversation.chat.user.images` gallery per attachment
          // (align 'end'), file cards render between them with the native
          // extension-badge + size meta — and `compact` counts every
          // attachment the way the native fold does. A
          // `conversation.chat.node` entry cannot dispatch those slots
          // directly — the host's `conversation.chat.user.content` factory
          // owns its child declaration, and chat-node renderers receive no
          // `renderSlot` seat — so the factory occurrence is the one legal
          // route back to the native gallery (mirrors ui-chat UserContent).
          content: {
            text: '',
            extraBlocks: [],
            attachments,
          },
          loadImage,
          facts: {},
          interactive: true,
        })}
        {(text !== '' || rest.length > 0) && (
          <div className={css.bubble} data-markdown-user-bubble>
            {composeUserMarkdown(text, labels, referenceLabels, skillNames)}
            {rest.map((block, index) => (
              <JsonBlock key={index} label={t('message.extraBlock')} payload={block} truncatedLabel={total => t('json.truncated', { total })} />
            ))}
          </div>
        )}
      </div>
      {/* The native userRow mounts the actions row after the stack — copy
          writes the raw wire text, the clock rides the node time. */}
      <MessageActions text={text} time={data.time} t={t} />
    </div>
  )
})
