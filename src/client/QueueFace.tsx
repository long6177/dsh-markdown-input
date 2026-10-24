/**
 * The takeover card's queue strip (issue #30): the queued-message view the
 * native composer renders in its `conversation.input.dock` (QueueDock),
 * which the takeover hides with the whole fallback bar — the overlay
 * election keeps the fallback mounted behind display:none. The card
 * rebuilds the same view from its own published planes; this component is
 * the render half over the queue-core view model. Behavior mirrors the
 * native dock: one row renders directly, several collapse behind a count
 * header, unadmitted submissions show as sending echoes with disabled
 * actions, rows carry edit (text-only) / remove (retract) / steer, and a
 * failed mutation reports on the card banner while the row stays.
 *
 * Attachments ride the rows too (#77): durable rows render thumbnails
 * through the session-authorized image loader (placeholder without the
 * face) and file chips, sending echoes render straight from their local
 * preview URLs; the preview keeps its single-line shape with the reference
 * chips the sent-text projection folds in.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  FileTypeIcon, fileSizeText,
  IconCheckOutlineMedium, IconChevronDownOutlineMedium, IconChevronUpOutlineMedium,
  IconCloseOutlineMedium, IconEditOutlineMedium, IconQueueOutlineMedium,
  IconSendOutlineMedium, IconTrashOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useObservable, type QueueAction, type QueueUpdate, type SessionId } from './conversation-face.ts'
import { referenceActions } from './reference-actions-face.ts'
import { NS } from './locales.ts'
import { skillFace } from './skill-face.ts'
import {
  contentText, echoAttachments, previewText, queueAttachments, type QueueViewRow,
} from './queue-core.ts'
import { projectUserText } from './user-text-projection.tsx'
import css from './MarkdownComposer.module.css'

export interface QueueFaceProps {
  /** Assembled strip rows (queue-core's `queueViewRows`), durable first. */
  readonly rows: readonly QueueViewRow[]
  /** Whether queued rows accept mutations at all (subagent address gate). */
  readonly mutable: boolean
  /** The session's running state; steering exists only mid-turn. */
  readonly running: boolean
  /** The session-scoped mutation verb; undefined sheds the action buttons. */
  readonly updateQueue: QueueUpdate | undefined
  /**
   * The session's durable-image URL resolver (the native dock's `loadImage`
   * inject); undefined sheds the durable thumbnails to their placeholder —
   * the rows, chips, and preview stay (#77).
   */
  readonly loadImage: ((attachment: unknown) => Promise<string>) | undefined
  readonly t: PropsLocale<typeof NS>['t']
  /** Card-banner outlet: a failed mutation reports here, the row stays. */
  readonly onError: (text: string) => void
  /**
   * The owning session: scopes the preview chips' activations (#75).
   * Undefined (or absent planes) keeps every chip a display-only span.
   */
  readonly sessionId?: SessionId | undefined
}

/** Chevron glyphs by expansion state (the native header's toggling pair). */
function chevron(expanded: boolean): React.ReactNode {
  return expanded ? <IconChevronDownOutlineMedium size={14} /> : <IconChevronUpOutlineMedium size={14} />
}

/**
 * One durable queued image as a fixed-size thumbnail: the loader resolves
 * the session-authorized URL, a failure (or an absent face) keeps the empty
 * placeholder — the native QueueThumb posture.
 */
function QueueThumb({ attachment, loadImage, label }: {
  attachment: unknown
  loadImage: QueueFaceProps['loadImage']
  label: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (loadImage === undefined) return undefined
    let alive = true
    loadImage(attachment).then(
      (resolved) => { if (alive) setUrl(resolved) },
      () => { /* placeholder retained; the durable transcript surfaces read errors */ },
    )
    return () => { alive = false }
  }, [attachment, loadImage])
  return url === null
    ? <span className={css.queueThumb} aria-hidden />
    : <img className={css.queueThumb} src={url} alt={label} />
}

/** Compact file identity used beside queue thumbnails (the native QueueFile). */
function QueueFileChip({ attachment, label }: {
  attachment: { readonly name?: string; readonly bytes?: number }
  label: string
}) {
  return (
    <span className={css.queueFile} aria-label={label} title={attachment.name ?? ''}>
      <span className={css.queueFileIcon} aria-hidden><FileTypeIcon path={attachment.name ?? ''} size={16} /></span>
      <span className={css.queueFileName}>{attachment.name}</span>
      <span className={css.queueFileSize}>{fileSizeText(attachment.bytes ?? 0)}</span>
    </span>
  )
}

/**
 * The queue strip, or null on an empty queue.
 * @param props - assembled rows, availability gates, copy, and the banner outlet.
 */
export function QueueFace({ rows, mutable, running, updateQueue, loadImage, t, onError, sessionId }: QueueFaceProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  // The preview chips' activations (#75): the same capability-detected
  // actions the durable bubbles use — a host without the preview planes
  // (or without the session id) keeps every chip display-only.
  const references = useMemo(() => referenceActions(sessionId), [sessionId])
  // The loaded skill roll: what lets a queued `/name` chip appear and
  // activate (beyond the native dock, whose previews carry no skillNames
  // facts and keep the gesture plain text).
  const skillEntries = useObservable(skillFace()?.lexicons)
  const skillNames = useMemo(() => {
    if (sessionId === undefined || skillEntries === undefined) return []
    return (skillEntries.value.get(sessionId) ?? []).map((skill) => skill.name)
  }, [sessionId, skillEntries])
  // The roll warms on mount (the completion face's idiom): a queued /name
  // chip can land with the strip's first paint instead of the first popup.
  useEffect(() => {
    if (sessionId !== undefined) skillFace()?.ensure(sessionId)
  }, [sessionId])

  const mutationActive = mutable && updateQueue !== undefined && (editing !== null || busy !== null)
  const expanded = !collapsed || mutationActive
  const listVisible = rows.length === 1 || expanded

  // An edit whose row left the queue (sent, retracted) or a session that
  // turned unmutable closes itself instead of saving into the void.
  useEffect(() => {
    if (editing !== null && (!mutable || !rows.some((row) => row.kind === 'queued' && row.id === editing.id))) {
      setEditing(null)
    }
  }, [editing, mutable, rows])

  // A drained strip refills collapsed (native dock parity: the count
  // header re-latches instead of reopening for the next queue).
  useEffect(() => {
    if (rows.length === 0 && !collapsed) setCollapsed(true)
  }, [collapsed, rows.length])

  // The inline editor: grow with content like the native QueueEditor.
  useLayoutEffect(() => {
    const node = editorRef.current
    if (node === null) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`
  }, [editing])

  if (rows.length === 0) return null

  const apply = async (id: string, action: QueueAction, failure: string): Promise<boolean> => {
    if (updateQueue === undefined) return false
    setBusy(id)
    try {
      await updateQueue(id, action)
      return true
    } catch {
      onError(failure)
      return false
    } finally {
      setBusy((current) => (current === id ? null : current))
    }
  }

  const saveEdit = (): void => {
    if (editing === null || busy !== null) return
    const text = editing.text.trim()
    if (text === '') return
    // Native parity: the editor closes only on a settled save — a failure
    // keeps it open for the retry (the banner names the cause).
    void apply(editing.id, { kind: 'edit', content: [{ type: 'text', text }] }, t('queue.editFailed'))
      .then((ok) => { if (ok) setEditing(null) })
  }

  const sendingPending = rows.some((row) => row.kind === 'sending')

  return (
    <div className={css.queue} data-markdown-queue>
      {rows.length > 1 && (
        <button type="button" className={css.queueHeader} aria-controls="markdown-queue-list"
          aria-expanded={expanded} disabled={mutationActive}
          onClick={() => { setCollapsed((value) => !value) }}>
          <span className={css.queueLead} aria-hidden><IconQueueOutlineMedium size={14} /></span>
          <span className={css.queueCount}>{t('queue.count', { n: rows.length })}</span>
          {!listVisible && sendingPending && <span className={css.queueStatus} role="status">{t('queue.sending')}</span>}
          <span className={css.queueChevron} aria-hidden>{chevron(expanded)}</span>
        </button>
      )}
      <ul id="markdown-queue-list" className={css.queueList} data-markdown-queue-list hidden={!listVisible}>
        {listVisible && rows.map((row) => {
          const editingRow = row.kind === 'queued' && editing?.id === row.id
            ? editing
            : null
          const text = row.kind === 'queued' ? contentText(row.content) : row.text
          const actions = mutable && updateQueue !== undefined
          // Attachment spans (#77): durable rows map their wire references
          // (thumbs through the loader, file chips with name + size);
          // sending rows render the echo's local preview URLs directly —
          // the submitter owns their lifetime (native pendingQueue parity).
          const attachments = row.kind === 'queued'
            ? queueAttachments(row.content)
            : echoAttachments(row.attachments)
          // The single-line preview with the reference chips folded in —
          // the vendored projection chips `@path` / `/skill` / the wire
          // session form, the plain runs stay verbatim.
          const preview = row.kind === 'queued' ? previewText(row.content) : row.text
          return (
            <li key={row.id} className={`${css.queueRow} ${row.kind === 'sending' ? css.queueSendingRow : ''}`}>
              {rows.length === 1 && (
                <span className={css.queueLead} aria-hidden><IconQueueOutlineMedium size={14} /></span>
              )}
              {editingRow !== null
                ? (
                  <textarea
                    ref={editorRef}
                    autoFocus
                    rows={1}
                    className={css.queueEditor}
                    aria-label={t('queue.edit')}
                    value={editingRow.text}
                    onChange={(event) => { setEditing({ id: row.id, text: event.currentTarget.value }) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setEditing(null)
                        return
                      }
                      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                      event.preventDefault()
                      saveEdit()
                    }}
                  />
                )
                : (
                  <>
                    {attachments.length > 0 && (
                      <span className={css.queueAttachments}>
                        {row.kind === 'queued'
                          ? queueAttachments(row.content).map((item, index) => item.type === 'image'
                            ? (
                              <QueueThumb
                                key={`d${index}`}
                                attachment={item.attachment}
                                loadImage={loadImage}
                                label={t('queue.image')}
                              />
                            )
                            : (
                              <QueueFileChip
                                key={`d${index}`}
                                attachment={item.attachment}
                                label={t('queue.file', { name: item.attachment.name ?? '' })}
                              />
                            ))
                          : echoAttachments(row.attachments).map((item, index) => item.type === 'image'
                            ? (
                              <img
                                key={`e${index}`}
                                className={css.queueThumb}
                                src={item.value?.previewUrl ?? ''}
                                alt={t('queue.image')}
                              />
                            )
                            : (
                              <QueueFileChip
                                key={`e${index}`}
                                attachment={item.value ?? {}}
                                label={t('queue.file', { name: item.value?.name ?? '' })}
                              />
                            ))}
                      </span>
                    )}
                    <span className={css.queuePreview}>{projectUserText(preview, [], skillNames, references)}</span>
                  </>
                )}
              {row.kind === 'sending' && (
                <span className={css.queueStatus} role="status">{t('queue.sending')}</span>
              )}
              {actions && (
                <div className={css.queueActions}>
                  {editingRow !== null
                    ? (
                      <>
                        <button type="button" className={css.queueAction}
                          aria-label={t('queue.save')} title={t('queue.save')}
                          disabled={busy !== null || editingRow.text.trim() === ''}
                          onClick={() => { saveEdit() }}>
                          <IconCheckOutlineMedium size={14} />
                        </button>
                        <button type="button" className={css.queueAction}
                          aria-label={t('queue.cancelEdit')} title={t('queue.cancelEdit')}
                          disabled={busy !== null}
                          onClick={() => { setEditing(null) }}>
                          <IconCloseOutlineMedium size={14} />
                        </button>
                      </>
                    )
                    : (
                      <>
                        <button type="button" className={css.queueAction}
                          aria-label={t('queue.edit')} title={text === null ? t('queue.edit.unsupported') : t('queue.edit')}
                          disabled={busy !== null || row.kind !== 'queued' || text === null}
                          onClick={() => {
                            if (row.kind === 'queued' && text !== null) setEditing({ id: row.id, text })
                          }}>
                          <IconEditOutlineMedium size={14} />
                        </button>
                        <button type="button" className={css.queueAction}
                          aria-label={t('queue.remove')} title={t('queue.remove')}
                          disabled={busy !== null || row.kind !== 'queued'}
                          onClick={() => {
                            if (row.kind === 'queued') void apply(row.id, { kind: 'remove' }, t('queue.removeFailed'))
                          }}>
                          <IconTrashOutlineMedium size={14} />
                        </button>
                        <button type="button" className={css.queueAction}
                          aria-label={t('queue.steer')} title={running ? t('queue.steer') : t('queue.steer.unavailable')}
                          disabled={busy !== null || row.kind !== 'queued' || !running}
                          onClick={() => {
                            if (row.kind === 'queued') void apply(row.id, { kind: 'steer' }, t('queue.steerFailed'))
                          }}>
                          <IconSendOutlineMedium size={14} />
                        </button>
                      </>
                    )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
