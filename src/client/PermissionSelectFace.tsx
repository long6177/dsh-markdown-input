/**
 * The tool-row permission face (ADR-0005 revival, toolbar row ②): the
 * current preset pill and the three-preset popup, rebuilt self-drawn — the
 * host's PermissionSelect is not exported — but riding the host's data
 * plane through permission-face.ts. Behavior aligns with the native picker:
 * the pill names the `permissions` projection's current preset (never a
 * static word), the popup is the primitives Menu opening upward through a
 * portal with the trailing-check selection and no fill on the selected row,
 * full access (and a future auto) passes the risk-confirmation gate, and a
 * switch writes `/permission <preset>` with no optimistic commit — the
 * pushed projection frame is the one confirmation, so a failed write
 * reverts the display. An admitted write on a chain-opened popup also
 * settles the chain (issue #36): the trigger token a typed `/per` opened it
 * from is consumed and focus returns to the editor; dismissals, cancellations
 * and failures leave the token in the draft. The face mounts inside its
 * FaceGate: a probe miss or a mid-life degrade hides this face alone, never
 * the card.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular, Menu, PermissionIconFullAccessRegular,
  PermissionIconReadOnlyRegular, PermissionIconWorkspaceWriteRegular, RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useObservable, type SessionId } from './conversation-face.ts'
import { registerChainPopup, type ChainPopupSettle } from './chain-open.ts'
import { en, NS, type ComposerKey } from './locales.ts'
import {
  permissionFace, permissionFaceHandle,
  type PermissionSelection,
} from './permission-face.ts'
import { registerFace } from './face.ts'
import css from './PermissionSelectFace.module.css'

/** Machine value of the preset that requires the explicit risk gate. */
const FULL_ACCESS = 'danger-full-access'

/** Machine value of the experimental review preset (present only when its host integration is live). */
const AUTO_REVIEW = 'auto'

/* Permission glyphs follow currentColor so the pill and rows tint the
   shared product artwork with their own text color; host-configured preset
   names outside the design set get none. */
const permissionGlyphs = new Map<string, ReactNode>([
  ['read-only', <PermissionIconReadOnlyRegular />],
  ['workspace-write', <PermissionIconWorkspaceWriteRegular />],
  [FULL_ACCESS, <PermissionIconFullAccessRegular />],
])

function permissionGlyph(value: string): ReactNode | undefined {
  return permissionGlyphs.get(value)
}

const PRESET_LABEL_KEYS = new Map<string, ComposerKey>([
  ['read-only', 'permission.preset.readOnly'],
  ['workspace-write', 'permission.preset.workspaceWrite'],
  [FULL_ACCESS, 'permission.preset.fullAccess'],
])

const DEFAULT_PRESET_LABELS: Record<string, string> = {
  'permission.preset.readOnly': en['permission.preset.readOnly'],
  'permission.preset.workspaceWrite': en['permission.preset.workspaceWrite'],
  'permission.preset.fullAccess': en['permission.preset.fullAccess'],
}

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/u.test(name)) return name
  return name.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a permission preset under its product label: the built-in three
 * localize through the dictionary while host-configured names (matching the
 * machine value or the EN default) stay host copy — the same contract the
 * host picker runs.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @param t - dictionary lookup.
 */
export function displayPermissionPreset(
  value: string,
  name: string,
  t: (key: ComposerKey) => string,
): string {
  const key = PRESET_LABEL_KEYS.get(value)
  if (key !== undefined && (name === value || name === DEFAULT_PRESET_LABELS[key])) return t(key)
  return displayPresetName(name)
}

/** Props of the permission face as the composer chain delivers them. */
export interface PermissionSelectFaceProps {
  /** Session projection hook; the `permissions` key carries the current preset. */
  readonly useProjection: (key: 'permissions') => PermissionSelection | undefined
  /** Owning session; undefined locks the face (nothing to write against). */
  readonly sessionId: SessionId | undefined
  readonly t: PropsLocale<typeof NS>['t']
  /** Owner lock (session gone) — disables the pill like the native seat. */
  readonly locked: boolean
  /** Card-banner outlet: a failed switch reports here, the pill stays usable. */
  readonly onError: (text: string) => void
}

/** Resolve locale-owned copy for the shipped Auto option; preserve host copy for other presets. */
function optionDescription(
  option: { readonly value: string; readonly description?: string },
  t: PermissionSelectFaceProps['t'],
): string | undefined {
  return option.value === AUTO_REVIEW ? t('permission.auto.description') : option.description
}

/**
 * The permission pill and its preset popup.
 * @param props - projection hook, session, copy, lock, and the banner outlet.
 * @returns the pill (with its portaled popup), or nothing while the face or
 * its data is absent.
 */
export function PermissionSelectFace({
  useProjection, sessionId, t, locked, onError,
}: PermissionSelectFaceProps): ReactNode {
  // The gate that mounts this body owns the probe; this is the lookup door
  // to its handle — an unmatched write latches the face off through it.
  const face = permissionFaceHandle()
  const [degraded, setDegraded] = useState(false)
  useEffect(() => face?.onDegrade(() => { setDegraded(true) }), [face])

  const selection = useProjection('permissions')
  const permission = permissionFace()
  const catalog = useObservable(permission?.catalog)?.value ?? null
  const [pick, setPick] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  // The chain settle hook of THIS opening (issue #36): armed only by a chain
  // open (a typed `/per` → permission row), invoked only after an admitted
  // write. Dismissals and failures drop it unused, so a later direct pill
  // pick can never consume a stale trigger token.
  const settleRef = useRef<ChainPopupSettle | null>(null)

  // The process catalog loads when a pill first wants to exist; the face's
  // invalidation subscription re-reads on catalog changes.
  useEffect(() => {
    if (permission !== undefined && permission.catalog.getSnapshot().value === null) {
      permission.refresh()
    }
  }, [permission])

  // Session loss, catalog loss, or a confirmed option the catalog no longer
  // carries retract the popup and the pending confirmation (host parity) —
  // and with them any unconsumed chain settle hook: the trigger token stays
  // in the draft.
  useEffect(() => {
    if (!locked && selection !== undefined && catalog !== null
      && (confirmation === null || catalog.options.some((option) => option.value === confirmation))) return
    settleRef.current = null
    setOpen(false)
    setAcknowledged(false)
    setConfirmation(null)
  }, [catalog, confirmation, locked, selection])

  // Chain-open seam for the `+` command menu (tool row ①): while this popup
  // face is alive and rendering UI the menu's permission row chains into it;
  // a probe miss or a mid-life degrade unregisters, hiding that menu row.
  // The opener also arms the caller's settle hook (#36) for the popup's
  // lifetime: a successful write consumes the token a typed trigger opened
  // the chain from; the `+` menu passes none.
  const canChain = !degraded && permission !== undefined && selection !== undefined && catalog !== null
  useEffect(() => {
    if (!canChain) return undefined
    return registerChainPopup('permission', (settle) => {
      settleRef.current = settle ?? null
      setOpen(true)
      return true
    })
  }, [canChain])

  if (degraded || permission === undefined || selection === undefined || catalog === null) return null
  // A local alias so the closures below read the narrowed face (TS narrowing
  // does not reach into function declarations).
  const faceData = permission

  // The in-flight pick may display (busy posture, host parity), but nothing
  // commits: after the write settles the projection's value rules again.
  const currentValue = pick !== null && catalog.options.some((option) => option.value === pick)
    ? pick : selection.currentValue
  const current = catalog.options.find((option) => option.value === currentValue)
  const currentLabel = current === undefined
    ? displayPermissionPreset(currentValue, currentValue, t)
    : displayPermissionPreset(current.value, current.name, t)
  const busy = pick !== null || confirmation !== null

  const items: MenuEntry[] = catalog.options.map((option) => {
    const icon = permissionGlyph(option.value)
    const label = option.value === AUTO_REVIEW
      ? t('permission.auto.label')
      : displayPermissionPreset(option.value, option.name, t)
    const badge = option.value === AUTO_REVIEW ? t('permission.auto.badge') : undefined
    return {
      id: option.value,
      label: badge === undefined
        ? label
        : (
          <span className={css.optionLabel} aria-label={`${label} ${badge}`}>
            <span className={css.optionLabelText}>{label}</span>
            <sup className={css.badge}>{badge}</sup>
          </span>
        ),
      ...(icon === undefined ? {} : { icon }),
    }
  })

  /**
   * Hand the pending chain settle hook its success (issue #36): the
   * chain-opened popup consumes the draft token that opened it and returns
   * focus to the editor (native PopupSelectController.settle tail). A direct
   * pill open has no hook and does nothing.
   */
  const settleSuccess = (): void => {
    const settle = settleRef.current
    settleRef.current = null
    settle?.()
  }

  function submit(id: string): void {
    if (sessionId === undefined) return
    setPick(id)
    void faceData.submit(sessionId, id)
      .then((result) => {
        if (result.kind === 'unmatched') {
          // The command surface is gone mid-life: latch the face off and
          // hide the pill on the next frame (FaceGate honors the verdict).
          // Nothing was written, so the chain token stays in the draft.
          settleRef.current = null
          face?.degrade('the host offers no /permission command')
        } else if (result.kind === 'failed') {
          // Host refusal: no consumption, and the popup is already gone —
          // drop the hook so a later pill pick cannot settle this token.
          settleRef.current = null
          onError(t('permission.switchFailed', { message: result.message }))
        } else {
          settleSuccess()
        }
      })
      .finally(() => { setPick(null) })
  }

  const choose = (id: string): void => {
    setOpen(false)
    if (id === selection.currentValue) {
      // The value in use is a settled pick too (no write): a chained open
      // still consumes its trigger token.
      settleSuccess()
      return
    }
    if (id === FULL_ACCESS || id === AUTO_REVIEW) {
      // The risk gate is a continuation, not a dismissal: the hook stays
      // armed for the confirmed write.
      setAcknowledged(false)
      setConfirmation(id)
      return
    }
    submit(id)
  }

  /**
   * Cancel the risk gate: a dismissal, so the chain settle hook is dropped
   * unused and the trigger token stays in the draft.
   */
  const closeConfirmation = (): void => {
    settleRef.current = null
    clearConfirmation()
  }

  /** Retract the risk gate without touching the pending chain settle (confirm path). */
  const clearConfirmation = (): void => {
    setAcknowledged(false)
    setConfirmation(null)
  }

  const autoConfirmation = confirmation === AUTO_REVIEW
  const currentBadge = currentValue === AUTO_REVIEW ? t('permission.auto.badge') : undefined
  const currentAccessibleLabel = currentBadge === undefined ? currentLabel : `${currentLabel} ${currentBadge}`
  const currentGlyph = permissionGlyph(currentValue)

  return (
    <>
      <Menu
        open={open}
        items={items}
        selectedId={currentValue}
        onSelect={choose}
        onClose={() => {
          // Escape / outside pointerdown / blur close the popup plainly: the
          // chain token stays in the draft and the unused hook is dropped.
          settleRef.current = null
          setOpen(false)
        }}
        side="top"
        portal
        anchor={
          <button
            type="button"
            className={css.trigger}
            data-permission-pill
            aria-label={t('permission.mode', { name: currentAccessibleLabel })}
            title={current === undefined ? undefined : optionDescription(current, t)}
            disabled={locked || busy}
            onClick={() => {
              // A direct pill open is never a chain open: no hook to settle.
              settleRef.current = null
              setOpen(!open)
            }}
          >
            {currentGlyph !== undefined && (
              <span className={css.triggerIcon} aria-hidden>{currentGlyph}</span>
            )}
            <span className={css.triggerLabel}>{currentLabel}</span>
            {currentBadge !== undefined && (
              <sup className={css.badge}>{currentBadge}</sup>
            )}
            <span className={`${css.chevron}${open ? ` ${css.chevronOpen}` : ''}`} aria-hidden>
              <IconChevronDownOutlineRegular />
            </span>
          </button>
        }
      />
      {confirmation !== null && (
        <RiskConfirmation
          open
          title={autoConfirmation ? t('permission.auto.confirm.title') : t('permission.confirm.title')}
          description={autoConfirmation
            ? t('permission.auto.confirm.description')
            : t('permission.confirm.description')}
          acknowledgeLabel={autoConfirmation
            ? t('permission.auto.confirm.acknowledge')
            : t('permission.confirm.acknowledge')}
          cancelLabel={t('permission.confirm.cancel')}
          closeLabel={t('permission.close')}
          confirmLabel={autoConfirmation
            ? t('permission.auto.confirm.enable')
            : t('permission.confirm.enable')}
          acknowledged={acknowledged}
          disabled={locked}
          onAcknowledgedChange={setAcknowledged}
          onCancel={closeConfirmation}
          onConfirm={() => {
            const id = confirmation
            // Confirming is the settle, not a dismissal: the pending chain
            // hook stays armed across the write (only cancel drops it).
            clearConfirmation()
            if (id !== null) submit(id)
          }}
        />
      )}
    </>
  )
}
