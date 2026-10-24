/**
 * Vendored display projection of reference forms in sent user text — the
 * `dsh-v0.2.0-rc.2` `projectUserText` grammar (ui-primitives
 * `user-text.tsx`) re-based on rc.2's public pieces: plain runs render
 * through `UserTextRun`, chips through `ReferenceChip`. Upstream rc.2
 * removed the projection itself and moved reference *recognition* into the
 * host data layer (`conversation.user.text` rules — which at rc.2 run the
 * file/folder (ui-reference), skill (ui-skill), secret (ui-secret-mask),
 * and session rules over the `conversation.user.text` factory), but this
 * plugin serves the bubbles from the `conversation.chat.node` seat one
 * layer up, where that factory never runs — so the projection stays
 * vendored and the data layer's file/folder/skill/secret capabilities are
 * rebuilt here (this module keeps the old grammar explicit and
 * unit-tested, `tests/user-text-projection.test.tsx`); if the host's
 * factory ever serves the chat-node seats, this vendored grammar is the
 * thing to retire.
 *
 * Token recognition lives once in `ref-grammar.ts`, shared with the draft
 * editor's chip scan; the session-label pass (exact labels supplied by an
 * adjacent recall decorate their bare `@label` mention) rides the same scan
 * through `sessionLabels`. This module is the presentational refinement:
 * session chips fold to their label, `at` tokens pick the file/folder
 * appearance and display basename, loaded `/name` tokens show the slash
 * form. Markdown syntax is deliberately not consulted (text-shape-only).
 *
 * Activation (#75) mirrors the host's published `projectUserText` shape:
 * with `references` actions, file chips render as buttons opening the
 * decoded path (a synchronous failure raises the native retry dialog) and
 * skill chips render as buttons previewing the entry's source; folders,
 * sessions, and every chip without actions stay display-only spans. The
 * `ReferenceChip` button branch carries the native double-click and
 * text-selection guards.
 *
 * Secret masking (#75) rebuilds the ui-secret-mask rule over the same
 * vendored grammar: recognized credential ranges (the pure scanner in
 * `secret-mask.ts`) draw their mask inline with — in interactive text — the
 * native per-value reveal control. Masking changes only the drawn text: the
 * message text, the copy action, and the model input keep the original
 * characters. The rules walk the text like the native evaluator — the
 * earliest match takes its span, so a chip whose own label carries a
 * credential-shaped run stays whole, and a credential the chip's span
 * starts after masks normally.
 */
import { useState, type ReactNode } from 'react'
import { Button, Modal, ReferenceChip, UserTextRun } from '@deepseek-ai/dsh-client-ui-primitives'
import { fileOpenCopy, secretToggleCopy } from './reference-locale.ts'
import { scanSecrets } from './secret-mask.ts'
import { atTokenPath, scanRefTokens, type RefTokenRange } from './ref-grammar.ts'
import cssSecret from './user-text-projection.module.css'

/** The preview actions the activatable chips call (the native `references` shape). */
export interface UserTextReferences {
  /**
   * Open or reveal a file in the right Sidebar using the session's
   * authority.
   * @throws when navigation fails; the chip keeps a local retry dialog.
   */
  readonly openFile: (path: string) => void
  /** Preview a confirmed skill name's source. */
  readonly openSkill: (name: string) => void
}

/**
 * A file chip with its activation: the click opens the decoded path, and a
 * synchronous navigation failure raises the native retry dialog — close
 * dismisses it, retry replays the same open (`FileReference` verbatim,
 * with the dialog's copy read through the host `reference` namespace and
 * the plugin's verbatim fallback). Exported for the bubble's Markdown
 * partition, which must treat the element (chip + dialog fragment) as a
 * chip, not a run.
 */
export function ActivatableFileChip({ display, title, path, openFile }: {
  readonly display: string
  readonly title: string
  readonly path: string
  readonly openFile: (path: string) => void
}): ReactNode {
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const copy = fileOpenCopy()
  const close = (): void => { setFailedPath(null) }
  const open = (): void => {
    try {
      openFile(path)
    } catch {
      setFailedPath(path)
      return
    }
    setFailedPath(null)
  }
  return (
    <>
      <ReferenceChip appearance="file" label={display} title={title} onActivate={open} />
      {failedPath === path && (
        <Modal
          open
          onClose={close}
          closeLabel={copy.close}
          title={copy.title}
          description={copy.failed(path)}
          footer={(
            <>
              <Button variant="outline" onClick={close}>{copy.close}</Button>
              <Button variant="primary" onClick={open}>{copy.retry}</Button>
            </>
          )}
        />
      )}
    </>
  )
}

/** The eye glyph contours (the native SecretText's own SVG paths). */
const EYE_CONTOUR = 'M1.5 8C2.9 5.25 5.25 3.5 8 3.5C10.75 3.5 13.1 5.25 14.5 8C13.1 10.75 10.75 12.5 8 12.5C5.25 12.5 2.9 10.75 1.5 8Z'
const EYE_PATH = `${EYE_CONTOUR}M10 8C10 9.1 9.1 10 8 10C6.9 10 6 9.1 6 8C6 6.9 6.9 6 8 6C9.1 6 10 6.9 10 8Z`
/** The struck-through glyph drops the pupil so it stays distinct at text size. */
const EYE_OFF_PATH = `${EYE_CONTOUR}M2.5 2.5L13.5 13.5`
const MASK_RUNS = /(\*+)/u

function EyeGlyph({ path }: { readonly path: string }): ReactNode {
  return (
    <svg className={cssSecret.icon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

/**
 * Split the masked form into kept text and mask runs. Mask runs keep their
 * characters for copying and assistive technology but draw centered marks,
 * because a font's own asterisk sits near the cap height.
 */
function MaskedText({ masked }: { readonly masked: string }): ReactNode {
  let offset = 0
  return masked.split(MASK_RUNS).map((part) => {
    const key = offset
    offset += part.length
    if (part === '') return null
    return part.startsWith('*')
      ? <span key={key} className={cssSecret.mask}>{part}</span>
      : <span key={key}>{part}</span>
  })
}

/**
 * One masked credential with its per-value reveal control in interactive
 * text. The state holds the revealed RAW value, not a flag: a different
 * credential that reuses the element starts masked again (the native
 * SecretText fold).
 */
export function SecretSpan({ raw, masked, interactive }: {
  readonly raw: string
  readonly masked: string
  readonly interactive: boolean
}): ReactNode {
  const [revealedRaw, setRevealedRaw] = useState<string | undefined>()
  const revealed = revealedRaw === raw
  const copy = secretToggleCopy()
  return (
    <span className={cssSecret.secret} data-secret="">
      <span className={cssSecret.value}>
        {revealed ? <UserTextRun text={raw} /> : <MaskedText masked={masked} />}
      </span>
      {interactive && (
        <button
          type="button"
          className={cssSecret.toggle}
          aria-pressed={revealed}
          aria-label={revealed ? copy.hide : copy.reveal}
          onClick={() => { setRevealedRaw(revealed ? undefined : raw) }}
        >
          <EyeGlyph path={revealed ? EYE_OFF_PATH : EYE_PATH} />
        </button>
      )}
    </span>
  )
}

/**
 * Split one sent text into inline plain runs and reference chips.
 * @param text - the logged model text of the message.
 * @param sessionLabels - exact session mention labels associated by an adjacent recall.
 * @param slashNames - names a `/name` token may decorate as (the skills loaded for this message).
 * @param references - the preview actions; absent keeps every chip display-only (the
 *   queue previews' posture, and the host-missing-planes degradation).
 * @param interactive - whether a secret's reveal control renders (the durable bubbles;
 *   the queue previews and the submission echo stay control-less like the native
 *   preview text).
 * @returns inline nodes covering the whole text.
 */
export function projectUserText(
  text: string,
  sessionLabels: readonly string[],
  slashNames: readonly string[] = [],
  references?: UserTextReferences,
  interactive = false,
): ReactNode {
  // The rules walk the text like the native evaluator: the earliest match
  // takes its span (same-start ties keep the secret on top), so the pieces
  // are one sorted list walked with a cursor.
  const pieces: Array<{ start: number, end: number, render: (key: number) => ReactNode, secret?: boolean }> = []
  for (const token of scanRefTokens(text, { sessionLabels, skills: new Set(slashNames) })) {
    pieces.push({ start: token.start, end: token.end, render: (key) => renderChip(token, key, references) })
  }
  for (const range of scanSecrets(text)) {
    pieces.push({
      start: range.start,
      end: range.end,
      secret: true,
      render: (key) => <SecretSpan key={key} raw={text.slice(range.start, range.end)} masked={range.masked} interactive={interactive} />,
    })
  }
  pieces.sort((a, b) => a.start - b.start || (a.secret === true ? -1 : 1) || b.end - a.end)
  const parts: ReactNode[] = []
  let cursor = 0
  const pushPlain = (from: number, to: number): void => {
    parts.push(<UserTextRun key={`t${from}`} text={text.slice(from, to)} />)
  }
  for (const [index, piece] of pieces.entries()) {
    if (piece.start < cursor) continue // an earlier piece took the span
    if (piece.start > cursor) pushPlain(cursor, piece.start)
    parts.push(piece.render(index))
    cursor = piece.end
  }
  if (parts.length === 0) return <UserTextRun text={text} />
  if (cursor < text.length) pushPlain(cursor, text.length)
  return <>{parts}</>
}

/** Render one reference token (the chip kinds and their display refinement). */
function renderChip(token: RefTokenRange, key: number, references: UserTextReferences | undefined): ReactNode {
  const { label, kind } = token
  // The projection's own folder test on bare `@` tokens (its strip of the
  // whole label differs from atTokenPath's on a trailing-quote edge — a
  // preserved pre-existing divergence, documented at the ref-grammar seam).
  const appearance = kind === 'session'
    ? 'session'
    : kind === 'skill'
      ? 'skill'
      : label.replace(/^@"|"$/gu, '').endsWith('/') ? 'folder' : 'file'
  const displayLabel = token.display
    ?? (kind === 'skill'
      ? label
      : appearance === 'session'
        ? label.slice(1)
        : atTokenPath(label).split(/[\\/]/u).filter(Boolean).at(-1) ?? label.slice(1))
  // Session and folder references are labels upstream too: only files
  // and skills carry an activation, and only when the actions exist.
  if (appearance === 'file' && references !== undefined) {
    return (
      <ActivatableFileChip
        key={key}
        display={displayLabel}
        title={label}
        path={atTokenPath(label)}
        openFile={references.openFile}
      />
    )
  }
  if (kind === 'skill' && references !== undefined) {
    return (
      <ReferenceChip
        key={key}
        appearance="skill"
        label={displayLabel}
        title={label}
        onActivate={() => { references.openSkill(label.slice(1)) }}
      />
    )
  }
  return (
    <ReferenceChip
      key={key}
      appearance={appearance}
      label={displayLabel}
      title={label}
    />
  )
}
