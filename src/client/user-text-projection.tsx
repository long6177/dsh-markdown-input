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
 * Grammar (verbatim from rc.0): the wire session form
 * `@[label](dsh-session:...)` folds to its label; exact session labels
 * supplied by an adjacent recall decorate their bare `@label` mention;
 * plain `@name` tokens decorate by shape alone (quoted whitespace form or
 * any non-space run, trailing sentence punctuation stripped, a trailing
 * slash marking a folder); a plain `/name` token decorates only when the
 * caller names it, whitespace-bounded like the host skill gesture
 * (`dsh-tool-skill`) so slash paths and punctuation-glued tokens stay
 * plain. Markdown syntax is deliberately not consulted (text-shape-only).
 */
import type { ReactNode } from 'react'
import { ReferenceChip, UserTextRun } from '@deepseek-ai/dsh-client-ui-primitives'

/** The wire form a session chip serializes to; label is the display text. */
const SESSION_WIRE_RE = /@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/gu

/** Sentence punctuation a bare `@name` token may carry without being part of the reference. */
const TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？]+$/u

interface DecorationRange {
  readonly start: number
  readonly end: number
  /** Matched source text (hover title). */
  readonly label: string
  readonly kind: 'session' | 'plain'
  /** Pre-resolved display text (wire folds); derived from label when absent. */
  readonly display?: string
}

/**
 * Split one sent text into inline plain runs and reference chips.
 * @param text - the logged model text of the message.
 * @param sessionLabels - exact session mention labels associated by an adjacent recall.
 * @param slashNames - names a `/name` token may decorate as (the skills loaded for this message).
 * @param slashKind - the chip kind those tokens render as.
 * @returns inline nodes covering the whole text.
 */
export function projectUserText(
  text: string,
  sessionLabels: readonly string[],
  slashNames: readonly string[] = [],
  slashKind: 'skill' | 'command' = 'skill',
): ReactNode {
  const ranges: DecorationRange[] = []
  SESSION_WIRE_RE.lastIndex = 0
  let wire: RegExpExecArray | null
  while ((wire = SESSION_WIRE_RE.exec(text)) !== null) {
    ranges.push({
      start: wire.index,
      end: wire.index + wire[0].length,
      label: wire[0],
      kind: 'session',
      display: wire[1] as string, // non-optional capture in SESSION_WIRE_RE
    })
  }
  for (const rawLabel of [...new Set(sessionLabels)].sort((a, b) => b.length - a.length)) {
    const label = `@${rawLabel}`
    let start = text.indexOf(label)
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, label, kind: 'session' })
      start = text.indexOf(label, start + label.length)
    }
  }
  // A `/` token ends at whitespace or the text end like the host skill
  // gesture; only `@` tokens shed sentence punctuation below.
  const re = /(^|\s)(\/[\w-]+(?=\s|$)|@"[^"\n]+"|@[^\s]+)/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + (m[1] as string).length // (^|\s) captures '' at line start
    const rawLabel = m[2] as string // non-optional alternation capture
    const label = rawLabel.startsWith('@"')
      ? rawLabel
      : rawLabel.replace(TRAILING_PUNCTUATION_RE, '')
    if (label.length <= 1) continue
    if (label.startsWith('/') && !slashNames.includes(label.slice(1))) continue
    ranges.push({ start: tokenStart, end: tokenStart + label.length, label, kind: 'plain' })
  }
  const rankOf = (range: DecorationRange): number => range.kind === 'session' ? 0 : 1
  ranges.sort((a, b) => a.start - b.start || rankOf(a) - rankOf(b) || b.end - a.end)
  const parts: ReactNode[] = []
  let cursor = 0
  const pushPlain = (from: number, to: number): void => {
    parts.push(<UserTextRun key={`t${from}`} text={text.slice(from, to)} />)
  }
  for (const range of ranges) {
    if (range.start < cursor) continue
    const { start: tokenStart, end, label, kind } = range
    if (tokenStart > cursor) pushPlain(cursor, tokenStart)
    const appearance = kind === 'session'
      ? 'session'
      : label.startsWith('@')
        ? label.replace(/^@"|"$/gu, '').endsWith('/') ? 'folder' : 'file'
        : slashKind
    const displayLabel = range.display
      ?? (kind === 'plain' && !label.startsWith('@')
        ? label
        : appearance === 'session'
          ? label.slice(1)
          : label.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? label.slice(1))
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
