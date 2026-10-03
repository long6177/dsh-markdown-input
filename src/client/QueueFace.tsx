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
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconCheckOutlineMedium, IconChevronDownOutlineMedium, IconChevronUpOutlineMedium,
  IconCloseOutlineMedium, IconEditOutlineMedium, IconQueueOutlineMedium,
  IconSendOutlineMedium, IconTrashOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { QueueAction, QueueUpdate } from './conversation-face.ts'
import { NS } from './locales.ts'
import {
  contentText, previewText, type QueueViewRow,
} from './queue-core.ts'
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
  readonly t: PropsLocale<typeof NS>['t']
  /** Card-banner outlet: a failed mutation reports here, the row stays. */
  readonly onError: (text: string) => void
}

/** Chevron glyphs by expansion state (the native header's toggling pair). */
function chevron(expanded: boolean): React.ReactNode {
  return expanded ? <IconChevronDownOutlineMedium size={14} /> : <IconChevronUpOutlineMedium size={14} />
}

/**
 * The queue strip, or null on an empty queue.
 * @param props - assembled rows, availability gates, copy, and the banner outlet.
 */
export function QueueFace({ rows, mutable, running, updateQueue, t, onError }: QueueFaceProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)

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
                  <span className={css.queuePreview}>
                    {row.kind === 'queued' ? previewText(row.content) : row.text}
                  </span>
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
