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
  FileTypeIcon, fileSizeText, JsonBlock, MarkdownText, ReferenceChip, UserTextRun,
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
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
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

/** One content block of a user message, shaped for this projection. */
interface ContentPart {
  readonly type?: string
  readonly text?: string
  readonly attachment?: { readonly name?: string, readonly bytes?: number }
}

/** Split content blocks into joined text, images, files, and the rest. */
export function contentParts(content: readonly unknown[]): {
  text: string
  images: readonly UserImageBlock['attachment'][]
  files: readonly ContentPart[]
  rest: readonly unknown[]
} {
  const texts: string[] = []
  const images: UserImageBlock['attachment'][] = []
  const files: ContentPart[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as ContentPart
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) images.push((block as UserImageBlock).attachment)
    else if (b.type === 'file') files.push(b)
    else rest.push(block)
  }
  return { text: texts.join(''), images, files, rest }
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
  const { text, images, files, rest } = contentParts(data.content)
  // Stable per locale revision: a fresh object identity would rebuild
  // MarkdownText's caches per render (host parity).
  const labels = useMemo(() => markdownLabels(t), [t])
  const referenceLabels = data.referenceLabels ?? []
  const skillNames = data.skillNames ?? []
  return (
    <div className={css.row} data-markdown-user-message>
      <div className={css.stack}>
        {(images.length > 0 || files.length > 0) && (
          <div className={css.attachmentRow} data-message-attachments>
            {images.length > 0 && renderFactorySlot('conversation.chat.user.content', {
              // Images-only, text-less payload: the text keeps rendering in
              // this seat's Markdown bubble, the factory occurrence renders
              // just the native attachment row and dispatches the shipped
              // `conversation.chat.user.images` gallery (align 'end') with
              // this seat's `loadImage`. A `conversation.chat.node` entry
              // cannot dispatch that slot directly — the host's
              // `conversation.chat.user.content` factory owns its child
              // declaration, and chat-node renderers receive no `renderSlot`
              // seat — so the factory occurrence is the one legal route back
              // to the native gallery (mirrors ui-chat UserContent.tsx).
              content: {
                text: '',
                extraBlocks: [],
                attachments: images.map(attachment => ({
                  type: 'image',
                  image: { attachment },
                })) satisfies readonly UserContentAttachment[],
              },
              loadImage,
              facts: {},
              interactive: true,
            })}
            {files.map((file, index) => (
              <span key={index} className={css.fileCard} title={file.attachment?.name}>
                <FileTypeIcon className={css.fileIcon} path={file.attachment?.name ?? ''} />
                <span className={css.fileContent}>
                  <span className={css.fileName}>{file.attachment?.name}</span>
                  <span className={css.fileMeta}>{fileSizeText(file.attachment?.bytes ?? 0)}</span>
                </span>
              </span>
            ))}
          </div>
        )}
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
