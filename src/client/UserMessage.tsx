/**
 * Markdown-rendered user messages: the `conversation.chat.node` `user` and
 * `steering` seat replacement. Composes the host baseline Markdown pipeline
 * (`MarkdownText`) with the host user-text projection (`projectUserText`) —
 * reference chips stay chips, the surrounding text renders as Markdown.
 * Known v1 trade-off: a chip inside a running paragraph splits that
 * paragraph into blocks around the chip; boundary chips (the common cases)
 * read seamlessly.
 */
import { Children, Fragment, isValidElement, memo, useMemo, type ReactNode } from 'react'
import {
  DocumentFileIcon, fileSizeText, JsonBlock, MarkdownText, projectUserText,
  type MarkdownLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps, ChatNodeOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import css from './UserMessage.module.css'

/** The image payload shape the owner's renderer accepts, derived from it. */
type ImageSourceList = Parameters<ChatNodeOwnerProps['renderMessageImages']>[0]['images']

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
  return isValidElement(piece) && 'data-ref-chip' in piece.props
}

/** Plain-run text sits directly inside the projection's run spans. */
function runText(piece: ReactNode): string {
  return isValidElement(piece) && typeof piece.props.children === 'string' ? piece.props.children : ''
}

/**
 * Project the message text: chips inline, everything else through the host
 * Markdown pipeline. Chips come from the host projection unchanged; plain
 * runs merge back into Markdown documents per contiguous span.
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
  if (!pieces.some(isChip)) return <MarkdownText text={text} labels={labels} />

  const out: ReactNode[] = []
  let run: string[] = []
  const flush = (): void => {
    if (run.length > 0) {
      const source = run.join('')
      if (source.trim() !== '') out.push(<MarkdownText key={out.length} text={source} labels={labels} />)
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
  images: readonly unknown[]
  files: readonly ContentPart[]
  rest: readonly unknown[]
} {
  const texts: string[] = []
  const images: unknown[] = []
  const files: ContentPart[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as ContentPart
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image') images.push(b.attachment)
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
  node, renderMessageImages, t,
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
            {images.length > 0 && renderMessageImages({ images: images as ImageSourceList, align: 'end' })}
            {files.map((file, index) => (
              <span key={index} className={css.fileCard} title={file.attachment?.name}>
                <DocumentFileIcon className={css.fileIcon} />
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
    </div>
  )
})
