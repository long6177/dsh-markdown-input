/**
 * Seam: the vendored credential scanner and masker (#75) — the ui-secret-
 * mask rule's published behavior rebuilt as one pure module: the provider
 * key/token prefixes (with their run shapes and word-boundary rejection),
 * JSON Web Tokens, private key blocks, and the password of an address that
 * carries credentials; the mask forms (the 8-char readable prefix, the
 * BEGIN/END-keeping block mask, the full address mask, line breaks in
 * place). Expected values are independent literals worked by hand from the
 * format table — the module's own recomputation is never the oracle.
 */
import { describe, expect, it } from 'vitest'
import { maskSecrets, scanSecrets } from '../src/client/secret-mask.ts'

describe('scanSecrets — prefixed credentials', () => {
  it('masks a digit-carrying sk- key, keeping the 8-char readable prefix', () => {
    const text = 'token sk-abc123def456ghijklmn here'
    const [range] = scanSecrets(text)
    expect(range).toBeDefined()
    expect(range?.start).toBe(6)
    expect(range?.end).toBe(29)
    expect(maskSecrets(text)).toBe('token sk-abc12*************** here')
  })

  it('rejects a digit-free sk- run (hyphenated identifiers stay plain)', () => {
    expect(scanSecrets('token sk-abcdefghij here')).toHaveLength(0)
  })

  it('rejects a prefixed key glued to a word character', () => {
    expect(scanSecrets('mysk-abc123def456ghijklmn')).toHaveLength(0)
  })

  it('masks an exact-length AIza key and rejects a short one', () => {
    const key = 'AIzaSyA1234567890abcdefghijklmnopqrstuv' // AIza + 35 KEY chars
    expect(scanSecrets(`key ${key} end`)).toHaveLength(1)
    // The Google shape masks exactly 35 run characters; a longer run still
    // carries the format's head (the native fold's no-tail-boundary rule).
    expect(scanSecrets(`key ${key}z end`)).toHaveLength(1)
    expect(scanSecrets(`key ${key.slice(0, -1)} end`)).toHaveLength(0)
  })

  it('masks the GitHub and GitLab token prefixes at their fixed shapes', () => {
    const ghp = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz' // 36 alnum
    expect(scanSecrets(`see ${ghp}.`)).toHaveLength(1)
    const glpat = 'glpat-0123456789abcdefghij' // 20 KEY chars
    expect(scanSecrets(`see ${glpat}.`)).toHaveLength(1)
    expect(scanSecrets('see ghp_0123456789.')).toHaveLength(0)
  })

  it('masks a bounded cloud access key id at exactly 16 upper-alnum characters', () => {
    expect(scanSecrets('id AKIA0123456789ABCDEF next')).toHaveLength(1)
    expect(scanSecrets('id AKIA0123456789ABCDEFX next')).toHaveLength(0)
    expect(scanSecrets('id AKIA0123456789abcdef next')).toHaveLength(0)
  })

  it('masks a JSON Web Token across its three runs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const [range] = scanSecrets(`auth ${jwt} done`)
    expect(range?.start).toBe(5)
    expect(range?.end).toBe(5 + jwt.length)
    expect(maskSecrets(`auth ${jwt} done`)).toBe(`auth eyJhbGci${'*'.repeat(jwt.length - 8)} done`)
  })

  it('rejects a truncated JWT', () => {
    expect(scanSecrets('auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0 done')).toHaveLength(0)
  })
})

describe('scanSecrets — addresses and key blocks', () => {
  it('masks only the password of an address that carries credentials', () => {
    const text = 'login https://user:s3cret@x.io/path now'
    const [range] = scanSecrets(text)
    expect(range?.start).toBe(19)
    expect(range?.end).toBe(25)
    expect(maskSecrets(text)).toBe('login https://user:******@x.io/path now')
  })

  it('rejects an address whose password is missing or unbounded', () => {
    expect(scanSecrets('see https://user@x.io now')).toHaveLength(0)
    expect(scanSecrets('see https://x.io now')).toHaveLength(0)
  })

  it('rejects a password glued after a word-character scheme', () => {
    // 'xhttps' reads as a scheme of its own — the boundary rule only
    // requires a non-word character before the scheme's first letter.
    expect(scanSecrets('see xhttps://user:s3cret@x.io now')).toHaveLength(1)
  })

  it('masks a private key block, keeping the BEGIN and END lines and the breaks', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nabc\n123\n-----END RSA PRIVATE KEY-----\ntail'
    const [range] = scanSecrets(text)
    expect(range?.start).toBe(0)
    expect(range?.end).toBe(text.indexOf('\ntail'))
    expect(maskSecrets(text)).toBe(
      '-----BEGIN RSA PRIVATE KEY-----\n***\n***\n-----END RSA PRIVATE KEY-----\ntail',
    )
  })

  it('runs a key block without an END line to the end of the text', () => {
    const text = 'head\n-----BEGIN PRIVATE KEY-----\nabc'
    const [range] = scanSecrets(text)
    expect(range?.end).toBe(text.length)
    expect(maskSecrets(text)).toBe('head\n-----BEGIN PRIVATE KEY-----\n***')
  })

  it('rejects a malformed key-block header', () => {
    expect(scanSecrets('-----BEGIN notakey-----\nabc\n-----END notakey-----')).toHaveLength(0)
  })
})

describe('scanSecrets — overlap resolution', () => {
  it('joins overlapping candidates and keeps the earliest one mask', () => {
    // A key block whose body carries a ghp_ token: the block starts first,
    // so the whole block masks as a block; a later disjoint token masks
    // separately.
    const text = '-----BEGIN PRIVATE KEY-----\nghp_0123456789abcdefghijklmnopqrstuvwxyz\n-----END PRIVATE KEY-----\nghp_zyxwvutsrqponmlkjihgfedcba9876543210'
    const ranges = scanSecrets(text)
    expect(ranges).toHaveLength(2)
    const masked = maskSecrets(text)
    expect(masked.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true)
    expect(masked).not.toContain('ghp_0123456789')
    expect(masked).toContain('-----END PRIVATE KEY-----')
    expect(masked.endsWith('ghp_zyxw********************************')).toBe(true)
  })

  it('finds disjoint credentials in one text', () => {
    const text = 'a sk-abc123def456ghijklmn b https://user:s3cret@x.io c'
    expect(scanSecrets(text)).toHaveLength(2)
  })

  it('masks nothing in ordinary text', () => {
    expect(scanSecrets('no secrets here, just words and names=value pairs')).toHaveLength(0)
  })
})
