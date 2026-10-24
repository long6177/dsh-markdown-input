/**
 * The vendored credential scanner and masker (#75): the ui-secret-mask
 * rule's published behavior (dsh-v0.2.1-rc.2 `credential-formats.ts` /
 * `credential-scanner.ts` / `credential-masks.ts`) rebuilt as one pure
 * module. Upstream streams per-keystroke matches with an Int32Array memo;
 * this module scans whole texts in one pass and allocates nothing per
 * query — the projection renders sent (and queued) bubbles, not live
 * drafts, so the memo's work is folded into the single walk.
 *
 * Recognition is by published format alone: provider key/token prefixes
 * (each with its run shape and the word-boundary rule), JSON Web Tokens,
 * private key blocks from their `-----BEGIN` header, and the password of an
 * address that carries credentials. Free-form passwords and `name=value`
 * assignments have no such format and stay plain. Overlapping candidates
 * join the earliest one and take its mask (a later non-prefixed candidate
 * only extends the range), so no credential is drawn half masked.
 *
 * Masking changes only the drawn text — the message text, the copy action,
 * and the model input keep the original characters.
 */

/** Character that replaces each hidden credential character in the mask. */
const MASK = '*'
/** Leading characters of a prefixed key left readable: the provider prefix and little else. */
const VISIBLE_PREFIX = 8

/** Literal kinds; same-start candidates resolve by ascending kind. */
const KIND_KEY_BLOCK = 0
const KIND_ADDRESS = 1
const KIND_PREFIXED = 2

/** Run shapes of a prefixed format's character run after its literal. */
type RunShape = 'run' | 'bounded' | 'sk' | 'google' | 'jwt'
/** Character classes a prefixed run validates against. */
type RunClass = 'key' | 'alnum' | 'word' | 'alnum-dash' | 'upper'

interface CredentialFormat {
  /** ASCII literal the candidate begins with; no literal occurs inside another. */
  readonly literal: string
  readonly kind: number
  readonly shape: RunShape
  readonly run: RunClass
  readonly min: number
  /** Bounded shapes only. */
  readonly max?: number
}

const prefixed = (literal: string, shape: RunShape, run: RunClass, min: number, max?: number): CredentialFormat =>
  ({ literal, kind: KIND_PREFIXED, shape, run, min, max })

/** Every prefixed format matches more than the 8 characters a mask leaves readable. */
const CREDENTIAL_FORMATS: readonly CredentialFormat[] = [
  { literal: '-----BEGIN ', kind: KIND_KEY_BLOCK, shape: 'run', run: 'key', min: 0 },
  { literal: '://', kind: KIND_ADDRESS, shape: 'run', run: 'key', min: 0 },
  // Model services: `sk-` keys carry a digit, which hyphenated identifiers rarely do.
  prefixed('sk-', 'sk', 'key', 20),
  prefixed('AIza', 'google', 'key', 35),
  // Code hosting and package registries.
  prefixed('ghp_', 'run', 'alnum', 36),
  prefixed('gho_', 'run', 'alnum', 36),
  prefixed('ghu_', 'run', 'alnum', 36),
  prefixed('ghs_', 'run', 'alnum', 36),
  prefixed('ghr_', 'run', 'alnum', 36),
  prefixed('github_pat_', 'run', 'word', 22),
  prefixed('glpat-', 'run', 'key', 20),
  prefixed('npm_', 'run', 'alnum', 36),
  prefixed('hf_', 'run', 'alnum', 30),
  // Cloud access key IDs.
  prefixed('AKIA', 'bounded', 'upper', 16, 16),
  prefixed('ASIA', 'bounded', 'upper', 16, 16),
  prefixed('LTAI', 'bounded', 'alnum', 12, 20),
  prefixed('AKID', 'bounded', 'alnum', 28, 36),
  // Collaboration and payment services.
  prefixed('xoxa-', 'run', 'alnum-dash', 10),
  prefixed('xoxb-', 'run', 'alnum-dash', 10),
  prefixed('xoxp-', 'run', 'alnum-dash', 10),
  prefixed('xoxr-', 'run', 'alnum-dash', 10),
  prefixed('xoxs-', 'run', 'alnum-dash', 10),
  prefixed('sk_live_', 'run', 'alnum', 16),
  prefixed('sk_test_', 'run', 'alnum', 16),
  prefixed('rk_live_', 'run', 'alnum', 16),
  prefixed('rk_test_', 'run', 'alnum', 16),
  prefixed('whsec_', 'run', 'alnum', 24),
  prefixed('eyJ', 'jwt', 'key', 8, 2048),
]

/** Sticky run patterns per class: nothing backtracks, `lastIndex` is the end. */
const RUN_PATTERNS: Record<RunClass, RegExp> = {
  key: /[A-Za-z0-9_-]*/y,
  alnum: /[A-Za-z0-9]*/y,
  word: /\w*/y,
  'alnum-dash': /[A-Za-z0-9-]*/y,
  upper: /[A-Z0-9]*/y,
}

/** End of the run `class` matches at `start` (sticky test leaves `lastIndex` there). */
function runEnd(text: string, start: number, run: RunClass): number {
  const pattern = RUN_PATTERNS[run]
  pattern.lastIndex = start
  pattern.test(text)
  return pattern.lastIndex
}

function isWordAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false
  return /[A-Za-z0-9_]/u.test(text.charAt(index))
}

/** `[A-Z0-9 ]` label characters of a `PRIVATE KEY` header line. */
function isLabelChar(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x30 && code <= 0x39) || code === 0x20
}

/**
 * Offset after `[A-Z0-9 ]{0,40}PRIVATE KEY-----` at `start`, or -1; reads at
 * most 52 characters (the upstream labelEnd fold).
 */
function labelEnd(text: string, start: number): number {
  const limit = Math.min(text.length, start + 52)
  let index = start
  while (index < limit && isLabelChar(text.charCodeAt(index))) index++
  // "PRIVATE KEY" is label characters and the `-` after it is not, so the
  // run ends right after it.
  const tail = index - 'PRIVATE KEY'.length
  return index < start + 52 && tail >= start && text.startsWith('PRIVATE KEY-----', tail)
    ? tail + 'PRIVATE KEY-----'.length
    : -1
}

/** Whether `\b[a-z][a-z0-9+.-]{1,15}` ends at `at`; reads at most 17 characters back. */
function schemeBefore(text: string, at: number): boolean {
  for (let start = at - 1; start >= 0 && start >= at - 16; start--) {
    const code = text.charCodeAt(start)
    const isScheme = (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39)
      || code === 0x2b || code === 0x2d || code === 0x2e
    if (!isScheme) return false
    const isLower = code >= 0x61 && code <= 0x7a
    if (isLower && at - start >= 2 && !isWordAt(text, start - 1)) return true
  }
  return false
}

/** The `[^\s/:@?#]` user run class; non-ASCII non-space characters are user characters. */
function isUserCode(code: number): boolean {
  if (/\s/u.test(String.fromCharCode(code))) return false
  return code !== 0x2f && code !== 0x3a && code !== 0x40 && code !== 0x3f && code !== 0x23
}

/** The `[^\s/@?#]+` password run class. */
function isPasswordCode(code: number): boolean {
  if (/\s/u.test(String.fromCharCode(code))) return false
  return code !== 0x2f && code !== 0x40 && code !== 0x3f && code !== 0x23
}

/**
 * The password in `\b[a-z][a-z0-9+.-]{1,15}://[^\s/:@?#]{0,256}:[^\s/@?#]+@`
 * for the `://` at `at`; neither part crosses `?` or `#`, where the
 * authority ends.
 * @returns the password range, or undefined.
 */
function addressPassword(text: string, at: number): { start: number, end: number } | undefined {
  if (!schemeBefore(text, at)) return undefined
  const userStart = at + 3
  let userEnd = userStart
  while (userEnd < text.length && userEnd - userStart <= 256 && isUserCode(text.charCodeAt(userEnd))) userEnd++
  if (userEnd - userStart > 256 || text.charCodeAt(userEnd) !== 0x3a) return undefined
  const start = userEnd + 1
  let end = start
  while (end < text.length && isPasswordCode(text.charCodeAt(end))) end++
  if (end === start || text.charCodeAt(end) !== 0x40) return undefined
  return { start, end }
}

/** End of the `-----BEGIN …PRIVATE KEY-----` block at `at`: after its first complete `END` line, or the end of the text. */
function keyBlockEnd(text: string, at: number): number {
  const header = labelEnd(text, at + '-----BEGIN '.length)
  if (header < 0) return -1
  for (let line = text.indexOf('-----END ', header); line >= 0; line = text.indexOf('-----END ', line + 1)) {
    const end = labelEnd(text, line + '-----END '.length)
    if (end >= 0) return end
  }
  return text.length
}

/** End of the prefixed credential whose literal starts at `at`, or -1 (the upstream prefixedEnd fold). */
function prefixedEnd(text: string, format: CredentialFormat, at: number): number {
  const start = at + format.literal.length
  const min = format.min
  if (format.shape === 'sk') {
    // `(?=[A-Za-z0-9_-]{0,255}\d)[A-Za-z0-9_-]{20,}`: the next digit
    // rejects a digit-free `sk-` before any run is measured.
    let digit = start
    while (digit < text.length && !/[0-9]/u.test(text.charAt(digit))) digit++
    if (digit - start > 255) return -1
    const end = runEnd(text, start, format.run)
    return end - start >= min && digit < end ? end : -1
  }
  const end = runEnd(text, start, format.run)
  const length = end - start
  if (length < min) return -1
  if (format.shape === 'run') return end
  if (format.shape === 'google') return start + min
  if (format.shape === 'bounded') {
    return length <= (format.max ?? length) && !isWordAt(text, end) ? end : -1
  }
  // jwt: `[A-Za-z0-9_-]{8,2048}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}` after `eyJ`.
  if (length > (format.max ?? length) || !text.startsWith('.eyJ', end)) return -1
  const payloadStart = end + '.eyJ'.length
  const payloadEnd = runEnd(text, payloadStart, format.run)
  if (payloadEnd - payloadStart < min || text.charCodeAt(payloadEnd) !== 0x2e) return -1
  const signatureEnd = runEnd(text, payloadEnd + 1, format.run)
  return signatureEnd - (payloadEnd + 1) >= min ? signatureEnd : -1
}

/** One recognized credential range with its display form. */
export interface SecretRange {
  readonly start: number
  readonly end: number
  /** The mask: line breaks stay in place, one mark per character. */
  readonly masked: string
}

/** The earliest candidate's kind wins the mask; a non-prefixed join un-plainifies it. */
interface Candidate {
  start: number
  end: number
  kind: number
  plain: boolean
}

/** `text[start, end)` with every character except line breaks masked; a surrogate pair is one character. */
function maskRange(text: string, start: number, end: number): string {
  let masked = ''
  let count = 0
  for (let index = start; index < end; index++) {
    const code = text.charCodeAt(index)
    if (code === 0x0a || code === 0x0d) {
      // The break stays in place (the upstream marksThen fold).
      masked += `${MASK.repeat(count)}${code === 0x0a ? '\n' : '\r'}`
      count = 0
      continue
    }
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < end) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) index++
    }
    count++
  }
  return masked + MASK.repeat(count)
}

/**
 * The display form of one candidate range (the upstream CredentialMasks
 * fold): an address masks whole, a prefixed key keeps its 8-character
 * readable prefix, a key block keeps its BEGIN and END lines and every
 * line break.
 */
function maskOf(text: string, candidate: Candidate): string {
  const { start, end, kind, plain } = candidate
  if (kind === KIND_ADDRESS) return maskRange(text, start, end)
  if (kind === KIND_PREFIXED) {
    const prefix = text.slice(start, start + VISIBLE_PREFIX)
    return prefix + (plain ? MASK.repeat(end - start - VISIBLE_PREFIX) : maskRange(text, start + VISIBLE_PREFIX, end))
  }
  // Key block: keep the BEGIN line, the END line when present, and the
  // breaks; the body masks whole (the upstream bounded/lines split is an
  // optimization with the same output — runs never cross a line break).
  let bodyStart = start
  for (let index = start; index < end; index++) {
    if (text.charCodeAt(index) === 0x0a) {
      bodyStart = index + 1
      break
    }
  }
  let bodyEnd = end
  for (let index = end - '\n-----END'.length; index >= bodyStart; index--) {
    if (text.charCodeAt(index) === 0x0a && text.startsWith('-----END', index + 1)) {
      bodyEnd = index
      break
    }
  }
  return text.slice(start, bodyStart) + maskRange(text, bodyStart, bodyEnd) + text.slice(bodyEnd, end)
}

/**
 * Scan one text for credentials.
 * @param text - the sent (or queued) message text.
 * @returns the non-overlapping credential ranges in text order, each with
 *   its display mask.
 */
export function scanSecrets(text: string): SecretRange[] {
  if (text === '') return []
  const candidates: Candidate[] = []
  for (const format of CREDENTIAL_FORMATS) {
    let index = text.indexOf(format.literal)
    while (index >= 0) {
      if (format.kind === KIND_KEY_BLOCK) {
        const end = keyBlockEnd(text, index)
        if (end >= 0) candidates.push({ start: index, end, kind: format.kind, plain: false })
      } else if (format.kind === KIND_ADDRESS) {
        const password = addressPassword(text, index)
        if (password !== undefined) {
          candidates.push({ start: password.start, end: password.end, kind: format.kind, plain: false })
        }
      } else if (!isWordAt(text, index - 1)) {
        const end = prefixedEnd(text, format, index)
        if (end >= 0) candidates.push({ start: index, end, kind: format.kind, plain: true })
      }
      index = text.indexOf(format.literal, index + 1)
    }
  }
  // Candidates arrive per literal; sort to start order (same-start ties
  // resolve by ascending kind, longer first) and merge overlaps onto the
  // earliest candidate.
  candidates.sort((a, b) => a.start - b.start || a.kind - b.kind || b.end - a.end)
  const merged: Candidate[] = []
  for (const candidate of candidates) {
    const last = merged[merged.length - 1]
    if (last !== undefined && candidate.start < last.end) {
      if (candidate.end > last.end) {
        last.end = candidate.end
        if (candidate.kind !== KIND_PREFIXED) last.plain = false
      }
      continue
    }
    merged.push(candidate)
  }
  return merged.map((candidate) => ({
    start: candidate.start,
    end: candidate.end,
    masked: maskOf(text, candidate),
  }))
}

/**
 * The display form of one text: plain text verbatim, every credential
 * range's characters replaced by its mask.
 * @param text - the sent (or queued) message text.
 */
export function maskSecrets(text: string): string {
  const ranges = scanSecrets(text)
  if (ranges.length === 0) return text
  let masked = ''
  let cursor = 0
  for (const range of ranges) {
    masked += text.slice(cursor, range.start) + range.masked
    cursor = range.end
  }
  return masked + text.slice(cursor)
}
