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
  /**
   * The block's durable attachment reference (image/file blocks carry it on
   * the wire). Wire data is untrusted: a typed block without one is skipped
   * by the attachment extraction, never trusted into a card.
   */
  readonly attachment?: unknown
}

/** A durable image reference as the strip's thumbnail consumes it (structural). */
export type QueueImageRef = Record<string, unknown>

/** A durable file reference as the strip's chip consumes it (structural). */
export interface QueueFileRef {
  readonly name?: string
  readonly bytes?: number
}

/** One durable reference carried by a queued row, in wire block order. */
export type QueueAttachment =
  | { readonly type: 'image'; readonly attachment: QueueImageRef }
  | { readonly type: 'file'; readonly attachment: QueueFileRef }

/** One local submission echo attachment (the session snapshot's wire arm). */
export type QueueEchoAttachment =
  | { readonly type: 'image'; readonly value?: { readonly previewUrl?: string } }
  | { readonly type: 'file'; readonly value?: QueueFileRef }

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
  /** Local preview attachments; absent or malformed arms read as none. */
  readonly attachments?: readonly QueueEchoAttachment[]
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
  readonly attachments: readonly QueueEchoAttachment[]
}

export type QueueViewRow = QueueEditableRow | QueueSendingRow

/** Preview length cap, native dock parity (`QUEUE_PREVIEW_CHARS`). */
export const QUEUE_PREVIEW_CHARS = 200

/**
 * Extract one queued row's durable references in wire block order — the
 * native `queueAttachments` fold. Inbox projections are wire data despite
 * their typed face: a typed block without a reference is skipped rather
 * than trusted.
 * @param content - the row's wire content blocks.
 */
export function queueAttachments(content: readonly QueueContentBlock[]): readonly QueueAttachment[] {
  const attachments: QueueAttachment[] = []
  for (const block of content) {
    if (block.type === 'image') {
      const { attachment } = block as { attachment?: QueueImageRef }
      if (attachment !== undefined && attachment !== null) {
        attachments.push({ type: 'image', attachment })
      }
    } else if (block.type === 'file') {
      const { attachment } = block as { attachment?: QueueFileRef }
      if (attachment !== undefined && attachment !== null) {
        attachments.push({ type: 'file', attachment })
      }
    }
  }
  return attachments
}

/**
 * One sending row's display attachments from its echo: image arms with a
 * local preview URL render straight from the submitter's URL (no loader),
 * file arms with a value render as chips; the rest are skipped.
 * @param echo - the submission echo's wire attachments.
 */
export function echoAttachments(echo: readonly QueueEchoAttachment[] | undefined): readonly QueueEchoAttachment[] {
  if (echo === undefined) return []
  const out: QueueEchoAttachment[] = []
  for (const attachment of echo) {
    if (attachment.type === 'image' && typeof attachment.value?.previewUrl === 'string') {
      out.push(attachment)
    } else if (attachment.type === 'file' && attachment.value !== undefined && attachment.value !== null) {
      out.push(attachment)
    }
  }
  return out
}

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
    rows.push({ kind: 'sending', id: item.requestId, text: item.text, attachments: echoAttachments(item.attachments) })
  }
  return rows
}

/**
 * One row's single-line preview: text blocks joined, whitespace collapsed,
 * capped by code points. Non-text blocks contribute nothing — their presence
 * rides the rendered thumbnails and file chips beside the preview (#77,
 * retiring the `[type]` text markers), exactly like the native preview.
 * @param content - the row's wire content blocks.
 */
export function previewText(content: readonly QueueContentBlock[]): string {
  const flat = content
    .map((block) => (block.type === 'text' ? block.text ?? '' : ''))
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
