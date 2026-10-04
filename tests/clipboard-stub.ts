/**
 * Shared test helper: stub the async Clipboard API the primitives
 * `writeClipboard` prefers, so copy behaviors run against a recording
 * without touching the real clipboard. Restoring deletes the own property
 * the stub installed, returning jsdom to its clipboard-less baseline.
 * @param writeText - the recorder standing in for `navigator.clipboard.writeText`.
 * @returns restore function removing the stub.
 */
export function installClipboardStub(writeText: (text: string) => Promise<boolean>): () => void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  return () => {
    delete (navigator as { clipboard?: unknown }).clipboard
  }
}
