/**
 * The queue view-model core (issue #30): what the takeover card's queue
 * strip shows. The native composer renders queued messages in its
 * `conversation.input.dock` (QueueDock), which the takeover hides with the
 * whole fallback bar (`overlay: true` election keeps it mounted behind
 * display:none) — so the card rebuilds the same view from the published
 * planes it already holds: the input currency's `queue` rows (the facade
 * overlays the agent inbox's `next-turn` list) and the session snapshot's
 * `pendingSubmissions` echoes. The row math here mirrors the native dock:
 * transcript-placed echoes own their seat (their durable row, once it
 * lands, stays hidden from the strip), queued-placed echoes show as
 * optimistic "sending" rows until the inbox admits them.
 *
 * Host wire shapes are consumed through narrow structural types (the
 * conversation-face convention): inbox projections are wire data despite
 * their typed face, so a missing or foreign field degrades to the plain
 * reading rather than being trusted.
 */

/** One wire content block of a queued row (`text` only on text blocks). */
export interface QueueContentBlock {
  readonly type: string
  readonly text?: string
}

/** One durable queued row (the inbox `next-turn` item's structural face). */
export interface QueueRow {
  readonly id: string
  readonly content: readonly QueueContentBlock[]
  /** Producer source; composer sends carry `kind: 'user'` plus `rpcId`. */
  readonly source?: { readonly kind?: string; readonly rpcId?: unknown }
  /**
   * Native wire field the runtime placeholder formula reads
   * (`placement === 'queued'`, native InputBar's canSteerQueue); absent or
   * foreign placements never qualify.
   */
  readonly placement?: string
}

/** One local submission echo (the session snapshot's `pendingSubmissions`). */
export interface QueueSubmissionEcho {
  readonly requestId: string
  /** `'transcript' | 'queued' | 'steering'`; unknown placements read as neither. */
  readonly placement: string
  readonly text: string
}

/** A strip row backed by a durable (Host-admitted) queued message. */
export interface QueueEditableRow {
  readonly kind: 'queued'
  readonly id: string
  readonly content: readonly QueueContentBlock[]
}

/** A strip row still in flight locally: not yet admitted, not retractable. */
export interface QueueSendingRow {
  readonly kind: 'sending'
  readonly id: string
  readonly text: string
}

export type QueueViewRow = QueueEditableRow | QueueSendingRow

/** Preview length cap, native dock parity (`QUEUE_PREVIEW_CHARS`). */
export const QUEUE_PREVIEW_CHARS = 200

/**
 * Assemble the strip rows: durable rows in inbox order, then the still-
 * unadmitted queued echoes in submission order (FIFO, native dock parity).
 * @param queue - the input currency's `queue` rows.
 * @param pendingSubmissions - the session snapshot's local echoes.
 * @returns the rows to render, deduped.
 */
export function queueViewRows(
  queue: readonly QueueRow[],
  pendingSubmissions: readonly QueueSubmissionEcho[],
): readonly QueueViewRow[] {
  const inChat = new Set(pendingSubmissions
    .filter((item) => item.placement === 'transcript')
    .map((item) => item.requestId))
  const admitted = new Set<string>()
  const rows: QueueViewRow[] = []
  for (const item of queue) {
    const source = item.source
    const rpcId = source?.kind === 'user' && typeof source.rpcId === 'string' ? source.rpcId : undefined
    if (rpcId !== undefined) {
      admitted.add(rpcId)
      // A transcript-placed echo owns its seat in the chat; its durable row
      // never enters the strip ("Inbox acceptance does not move a Chat echo
      // into the dock", native dock parity).
      if (inChat.has(rpcId)) continue
    }
    rows.push({ kind: 'queued', id: item.id, content: item.content })
  }
  for (const item of pendingSubmissions) {
    if (item.placement !== 'queued' || admitted.has(item.requestId)) continue
    rows.push({ kind: 'sending', id: item.requestId, text: item.text })
  }
  return rows
}

/**
 * One row's single-line preview: text blocks joined, non-text blocks as
 * `[type]` markers, whitespace collapsed, capped by code points. The
 * markers are a deliberate deviation from the native preview (which drops
 * image/file blocks and renders thumbnails beside it): the strip has no
 * image face, so the preview must carry the attachment's presence.
 * @param content - the row's wire content blocks.
 */
export function previewText(content: readonly QueueContentBlock[]): string {
  const flat = content
    .map((block) => (block.type === 'text' ? block.text ?? '' : `[${block.type}]`))
    .join(' ').replace(/\s+/gu, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join('')}…` : flat
}

/**
 * The row's full text when every block is text (the edit precondition);
 * null otherwise — native parity: non-text rows are declared uneditable.
 * @param content - the row's wire content blocks.
 */
export function contentText(content: readonly QueueContentBlock[]): string | null {
  if (!content.every((block) => block.type === 'text')) return null
  return content.map((block) => block.text ?? '').join('')
}

/**
 * Whether queued rows accept mutations at all: subagent-addressed sessions
 * steer only while their address stays continuable (native `queueMutable`).
 * A session snapshot without the subagent field reads unmutable — the
 * conservative reading, since the missing field cannot prove the address
 * continuable.
 * @param subagent - the session snapshot's subagent, null when unaddressed.
 */
export function queueMutableOf(
  subagent: { readonly address: { readonly mode: string } } | null | undefined,
): boolean {
  if (subagent === undefined) return false
  if (subagent === null) return true
  return subagent.address.mode === 'continuable'
}
