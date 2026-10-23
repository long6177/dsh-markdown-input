/**
 * Vendored display projection of reference forms in sent user text — the
 * `dsh-v0.2.0-rc.2` `projectUserText` grammar (ui-primitives
 * `user-text.tsx`) re-based on rc.2's public pieces: plain runs render
 * through `UserTextRun`, chips through `ReferenceChip`. Upstream rc.2
 * removed the projection itself and moved reference *recognition* into the
 * host data layer (`conversation.user.text` rules), but at rc.2 that layer
 * only knows session and whitespace rules — adopting it would silently drop
 * the `@file` / `/skill` inline chips. This module keeps the old grammar
 * explicit and unit-tested (`tests/user-text-projection.test.tsx`) so the
 * sent bubble keeps today's chip UX; if the host later ships rules for
 * files and skills, this vendored grammar is the thing to retire.
 *
 * Token recognition lives once in `ref-grammar.ts`, shared with the draft
 * editor's chip scan; the session-label pass (exact labels supplied by an
 * adjacent recall decorate their bare `@label` mention) rides the same scan
 * through `sessionLabels`. This module is the presentational refinement:
 * session chips fold to their label, `at` tokens pick the file/folder
 * appearance and display basename, loaded `/name` tokens show the slash
 * form. Markdown syntax is deliberately not consulted (text-shape-only).
 */
import type { ReactNode } from 'react'
import { ReferenceChip, UserTextRun } from '@deepseek-ai/dsh-client-ui-primitives'
import { atTokenPath, scanRefTokens } from './ref-grammar.ts'

/**
 * Split one sent text into inline plain runs and reference chips.
 * @param text - the logged model text of the message.
 * @param sessionLabels - exact session mention labels associated by an adjacent recall.
 * @param slashNames - names a `/name` token may decorate as (the skills loaded for this message).
 * @returns inline nodes covering the whole text.
 */
export function projectUserText(
  text: string,
  sessionLabels: readonly string[],
  slashNames: readonly string[] = [],
): ReactNode {
  const tokens = scanRefTokens(text, { sessionLabels, skills: new Set(slashNames) })
  const parts: ReactNode[] = []
  let cursor = 0
  const pushPlain = (from: number, to: number): void => {
    parts.push(<UserTextRun key={`t${from}`} text={text.slice(from, to)} />)
  }
  for (const token of tokens) {
    const { start: tokenStart, end, label, kind } = token
    if (tokenStart > cursor) pushPlain(cursor, tokenStart)
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
    // Display-only chips: the plugin has no reference preview actions, so
    // `onActivate` stays absent and ReferenceChip renders the label span.
    parts.push(
      <ReferenceChip
        key={tokenStart}
        appearance={appearance}
        label={displayLabel}
        title={label}
      />,
    )
    cursor = end
  }
  if (parts.length === 0) return <UserTextRun text={text} />
  if (cursor < text.length) pushPlain(cursor, text.length)
  return <>{parts}</>
}
