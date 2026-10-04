/**
 * ESM stand-in for `use-sync-external-store/shim/with-selector` (see
 * vitest.config.ts): the upstream package ships only a CJS `require` shim
 * whose react resolution lands in the host checkout's pnpm store — a second
 * React in this process, which is exactly what the renderer-backed
 * reachability test (#43) must avoid. This file supplies the same two-export
 * surface over THIS project's react, delegating the selector memoization to
 * the platform hook (`react` >= 18 provides `useSyncExternalStore`, so the
 * package's selector wrapper is the only part worth keeping).
 */
import { useRef, useSyncExternalStore } from 'react'

/**
 * Subscribe to an external store and project a selected slice of it.
 * @param subscribe - the store's subscription.
 * @param getSnapshot - the store's current value.
 * @param getServerSnapshot - unused (client-only rendering), kept for signature parity.
 * @param selector - the value projection the calling hook applies.
 * @param isEqual - optional selected-value equality; `Object.is` otherwise.
 * @returns the selected value, re-read on every store notification.
 */
export function useSyncExternalStoreWithSelector<S, T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => S,
  getServerSnapshot: (() => S) | undefined,
  selector: (snapshot: S) => T,
  isEqual?: (left: T, right: T) => boolean,
): T {
  const selected = useRef<{ value: T } | null>(null)
  const getSelected = (): T => {
    const next = selector(getSnapshot())
    const previous = selected.current
    if (previous === null || !(isEqual?.(previous.value, next) ?? Object.is(previous.value, next))) {
      selected.current = { value: next }
    }
    return selected.current.value
  }
  void getServerSnapshot
  return useSyncExternalStore(subscribe, getSelected, getSelected)
}
