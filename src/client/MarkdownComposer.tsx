/**
 * The taken-over composer body: a CodeMirror 6 markdown surface (Obsidian-
 * style live rendering with a source-mode switch), the tool row, and submit.
 * Draft sync and submit ride the public inputActions face exactly as the v0
 * text face did; the editor owns the text between them.
 *
 * The peripheral alignment (ADR-0002) rides the same public state: draft
 * attachments are registered through the conversation service and admitted
 * via inputActions.addAttachments/removeAttachment against the one shared
 * InputState; machine notices (adjudication failures, send errors) and the
 * Session promptError surface on this card — during a takeover the resident
 * bar's toast is invisible, so this is the only notice surface. Busy
 * admission phases (adjudicating/submitting) disable the submit, attach,
 * drop, and remove actions and read-only the editor, matching the built-in
 * bar.
 *
 * The tool row is a federation of faces: the `+` command menu (T5), the
 * rebuilt permission preset selector (T3) and the vendored model/reasoning
 * selector (T4) mount inside their own FaceGates and read the host's
 * command-catalog, permission, and model data planes (command-face.ts,
 * permission-face.ts, model-face.ts) — a probe miss or a mid-life degrade
 * hides that face alone, the text face and the rest of the row stay. When
 * the command menu face is unavailable the legacy attach button takes its
 * place, so file intake never disappears with the menu.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, ReactNode } from 'react'
import {
  IconCloseOutlineMedium, IconPaperclipOutlineMedium, IconWarningOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ComposerAttachment, DraftAttachmentId,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MarkdownComposer.module.css'
import { CommandMenuFace } from './CommandMenuFace.tsx'
import { commandFaceDefinition } from './command-face.ts'
import { observeControlRow } from './control-row.ts'
import { fallbackToNative } from './degrade.ts'
import {
  attachmentFace as detectAttachmentFace, conversationFace, noticesOf, useObservable,
  type AttachmentFace,
} from './conversation-face.ts'
import { registerFace } from './face.ts'
import { FaceGate } from './FaceGate.tsx'
import { createMarkdownEditor, type EditMode, type MarkdownEditorHandle } from './markdown-editor.ts'
import { NS } from './locales.ts'
import { modelFaceDefinition } from './model-face.ts'
import { ModelSelectFace } from './ModelSelectFace.tsx'
import { permissionFaceDefinition } from './permission-face.ts'
import { PermissionSelectFace } from './PermissionSelectFace.tsx'
import { skillFace } from './skill-face.ts'

/** Selector marker this entry returns to win the composer chain election. */
export interface MarkdownTakeover {
  readonly kind: 'markdown'
}

/** The one non-null marker this chain entry elects with. */
export const MARKDOWN_TAKEOVER: MarkdownTakeover = { kind: 'markdown' }

/** Full chain props after this entry's selector accepts the owner currency. */
export type MarkdownComposerProps =
  PropsRuntime<'conversation.composer'>
  & { matched: MarkdownTakeover }
  & PropsLocale<typeof NS>

/** localStorage key the render/source preference persists under. */
export const MODE_STORAGE_KEY = 'dsh-markdown-input.mode'

/**
 * Trailing debounce for mirroring typed text into the machine draft. The
 * host persists that draft into its session store, which is what a page
 * reload adopts — a page unload skips React unmounts entirely, so the
 * unmount flush alone cannot survive F5.
 */
export const DRAFT_SYNC_DEBOUNCE_MS = 250

function storedMode(): EditMode {
  try {
    return window.localStorage.getItem(MODE_STORAGE_KEY) === 'source' ? 'source' : 'render'
  } catch {
    return 'render'
  }
}

function placeholderOf(t: MarkdownComposerProps['t'], mode: EditMode): string {
  return t(mode === 'render' ? 'composer.placeholder.render' : 'composer.placeholder.source')
}

/** Mode → copy mapping: the visible label names the CURRENT mode. */
function labelOf(t: MarkdownComposerProps['t'], mode: EditMode): string {
  return t(mode === 'render' ? 'composer.mode.render' : 'composer.mode.source')
}

/**
 * The taken-over composer card.
 * @param props - chain election marker plus standard session input props and copy.
 * @returns The composer replacement card.
 */
export function MarkdownComposer({ useInput, inputActions, useProjection, t, sessionId, session }: MarkdownComposerProps) {
  // Editor face (ADR-0005 hardening #2): the text face probes its own host
  // dependencies — the input hook and the two machine verbs it mirrors and
  // submits through — before anything else runs. The gate sits before the
  // FIRST hook call on purpose: a probed-away face returns without calling
  // any host hook at all, so even a broken `useInput` (alpha.0's renamed-
  // exports failure mode) cannot throw its way past the probe. The verdict
  // latches for the page life, so the early return is stable for this
  // instance (hook order stays consistent) and the fallback fires once.
  const actions = inputActions as unknown as { setDraft?: unknown; submit?: unknown } | undefined | null
  const editorFace = registerFace({
    id: 'editor',
    probe: () => typeof useInput === 'function' && actions !== null && actions !== undefined
      && typeof actions.setDraft === 'function' && typeof actions.submit === 'function',
  })
  const editorVerdict = editorFace.verdict()
  if (!editorVerdict.supported) {
    // Render-phase and one-shot: the card latch makes the report, the
    // notice, and the entry dispose idempotent (StrictMode re-renders
    // included); the null render only covers the frames before the unmount.
    fallbackToNative(`editor face probe failed (${editorVerdict.reason ?? 'unknown'})`)
    return null
  }

  const input = useInput((state) => state)
  const conversation = conversationFace()
  const [mode, setMode] = useState<EditMode>(storedMode)
  const [hasText, setHasText] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [banner, setBanner] = useState<{ seq: number; text: string } | null>(null)
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  // The editor handle as state: the tool-row faces need it in their effects
  // (the menu key seam binds on arrival), and child effects run before this
  // component's mount effect, so a ref alone would leave them unbound.
  const [editorHandle, setEditorHandle] = useState<MarkdownEditorHandle | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const toolRowRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // The `+` menu registers its close verb here; the card closes it whenever
  // the document changes (the host pipeline's trigger-track loss).
  const menuCloseRef = useRef<(() => void) | null>(null)
  const registerMenuClose = useCallback((close: (() => void) | null) => {
    menuCloseRef.current = close
  }, [])
  const touchedRef = useRef(false)
  const seedingRef = useRef(false)
  const draftSyncTimerRef = useRef<number | undefined>(undefined)
  // Refs mirroring the mutable faces so the editor (mounted once) always
  // reads the freshest session state without remounting.
  const inputRef = useRef(input)
  inputRef.current = input
  const inputActionsRef = useRef(inputActions)
  inputActionsRef.current = inputActions
  const tRef = useRef(t)
  tRef.current = t
  // The mounted-once editor reads the paste intake through this ref: the
  // intakeFiles closure is re-created every render, the editor's onFiles
  // seam is installed once (the same reason submit reads mirrored faces).
  const intakeFilesRef = useRef(intakeFiles)
  intakeFilesRef.current = intakeFiles

  // Busy admission phases — the machine refuses attachment add/remove there,
  // and the built-in bar read-onlys the editor while keeping the draft
  // visible. (Claimed stays editable: the claim args are ordinary text.)
  const machineBusy = input.phase === 'adjudicating' || input.phase === 'submitting'

  const bannerSeq = useRef(0)
  const showBanner = useCallback((text: string) => {
    bannerSeq.current += 1
    setBanner({ seq: bannerSeq.current, text })
  }, [])

  // Transient error banner (Toast parity: hold, then fade); keyed so an
  // identical repeated message restarts the cycle.
  useEffect(() => {
    if (banner === null) return undefined
    const timer = window.setTimeout(() => { setBanner(null) }, 6000)
    return () => { window.clearTimeout(timer) }
  }, [banner])

  const noticeSource = useMemo(
    () => conversation !== undefined && sessionId !== undefined
      ? noticesOf(conversation, sessionId)
      : undefined,
    [conversation, sessionId],
  )
  const notice = useObservable(noticeSource)
  // Attachment operations are capability-detected: host builds where the
  // service boundary moved shed the attachment UI, never the text face.
  const attachmentFace = detectAttachmentFace()
  const uploads = useObservable(attachmentFace?.fileUploads)

  // Skill lexicon face (T9): the hot `/` dictionary behind the editor's
  // chip decorations, capability-detected per call — a host build without
  // the `remote.skills` surface keeps slash tokens plain text while the
  // shape-only `@`/session arms still decorate (they need no data plane).
  const skills = skillFace()
  const skillLexicon = useObservable(skills?.lexicons)

  // Prompt failures are ordinary failures: the banner announces them, the
  // draft stays in the machine, the user resubmits. A remount over a session
  // whose failure is still pending re-announces it once (resident-bar
  // contract).
  const promptError = session?.promptError ?? null
  useEffect(() => {
    if (promptError === null) return
    const { error } = promptError
    showBanner(error.code === 'session/attachment-invalid' || error.code === 'subagent/attachment-invalid'
      ? tRef.current('composer.file.rejected')
      : `${error.message} (${error.code})`)
  }, [promptError, showBanner])

  useEffect(() => {
    if (notice?.level === 'error') showBanner(notice.text)
  }, [notice, showBanner])

  const attachments = useMemo<ComposerAttachment[]>(
    () => attachmentFace === undefined
      ? []
      : attachmentFace.resolveDraftAttachments(input.attachmentIds) as ComposerAttachment[],
    [attachmentFace, input.attachmentIds],
  )
  // Send waits for every picked file: uploading and failed drafts both hold
  // the gate (a failed upload is retried or removed, never silently dropped).
  const uploadsPending = attachments.some(
    (attachment) => attachment.kind === 'file' && uploads?.[attachment.id]?.status !== 'ready',
  )
  const uploadsPendingRef = useRef(false)
  uploadsPendingRef.current = uploadsPending

  // Keep the ids in line with the descriptors: entries whose browser-owned
  // objects died elsewhere (session teardown) fall off the draft.
  useEffect(() => {
    if (attachmentFace === undefined) return
    if (attachments.length !== input.attachmentIds.length) {
      inputActions.pruneAttachments(attachments.map((attachment) => attachment.id))
    }
  }, [attachmentFace, attachments, input.attachmentIds, inputActions])

  function submit(): void {
    const editor = editorRef.current
    if (editor === null || inputRef.current.phase !== 'plain') return
    if (uploadsPendingRef.current) {
      showBanner(tRef.current('composer.file.stillUploading'))
      return
    }
    // Cancel a pending draft mirror: firing after the machine clears the
    // sent draft would resurrect the sent text into the input.
    window.clearTimeout(draftSyncTimerRef.current)
    touchedRef.current = false
    inputActionsRef.current.setDraft(editor.getText())
    // Let the hidden resident editor apply the draft before submit reads
    // its projection; the phase re-checks at fire time in case the machine
    // left 'plain' in between.
    window.setTimeout(() => {
      if (inputRef.current.phase === 'plain') inputActionsRef.current.submit()
    }, 0)
  }

  useEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return undefined
    let editor: MarkdownEditorHandle
    try {
      editor = createMarkdownEditor({
        parent: surface,
        placeholder: '',
        mode: storedMode(),
        onSubmit: submit,
        onFiles: (files) => intakeFilesRef.current(files),
        onDocChange: (text) => {
          // Any document change invalidates the `+` menu's trigger track
          // (host parity: the menu closes; a claim insertion closes first,
          // so this is a no-op there).
          menuCloseRef.current?.()
          if (seedingRef.current) return
          touchedRef.current = true
          setHasText(text.trim().length > 0)
          // Live draft mirror: the host persists machine-draft changes, so the
          // typed text reaches it as the user types, not only on unmount/submit.
          window.clearTimeout(draftSyncTimerRef.current)
          draftSyncTimerRef.current = window.setTimeout(() => {
            inputActionsRef.current.setDraft(text)
          }, DRAFT_SYNC_DEBOUNCE_MS)
        },
      })
    } catch (error: unknown) {
      // A mount that throws is the editor face failing mid-life — degrade
      // the face in the framework and escalate to the card fallback (native
      // composer tops back in), never let the exception escape into the
      // host shell (alpha.0).
      editorFace.degrade('editor face mount failed')
      fallbackToNative('editor face mount failed', error)
      return undefined
    }
    editorRef.current = editor
    setEditorHandle(editor)
    // A page reload never runs React unmounts; flush on the unload event so
    // the trailing debounce window cannot eat the draft's tail.
    const onPageHide = (): void => {
      window.clearTimeout(draftSyncTimerRef.current)
      inputActionsRef.current.setDraft(editor.getText())
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.clearTimeout(draftSyncTimerRef.current)
      // A takeover election unmounts this card while the host keeps its
      // persisted draft; flush the text face so the draft survives the swap
      // and seeds this card back on remount.
      inputActionsRef.current.setDraft(editor.getText())
      editor.destroy()
      editorRef.current = null
      setEditorHandle(null)
    }
  }, [])

  // Seed from the persisted draft until the user edits locally; after a
  // settled submit the machine clears the draft and this clears the surface.
  useEffect(() => {
    if (touchedRef.current) return
    seedingRef.current = true
    editorRef.current?.setText(input.draft)
    seedingRef.current = false
    setHasText(input.draft.trim().length > 0)
  }, [input.draft])

  // Chip decorations (T9). Warm the skill lexicon once per session and push
  // the live roll into the editor — the RPC resolves after mount, so the
  // effect re-fires on arrival; until then (or without the face at all)
  // the editor holds an empty roll and slash tokens stay plain text.
  useEffect(() => {
    if (skills !== undefined && sessionId !== undefined) skills.ensure(sessionId)
    const names = skills !== undefined && sessionId !== undefined
      ? skillLexicon?.value.get(sessionId)
      : undefined
    editorHandle?.setSkillLexicon(names ?? [])
  }, [skills, sessionId, skillLexicon, editorHandle])

  // Claim ghost hint (T9): the native claim decoration — while a command
  // claim holds, the resolved per-command hint (the translated native key
  // wins, the machine's own hint answers for other claimed commands) rides
  // into the editor, which decides blank-args from its live document.
  const hasGoal = useProjection('goal', (goal: unknown) => goal != null) === true
  useEffect(() => {
    const claim = input.claim
    const claimed = input.phase === 'claimed' || input.phase === 'submitting'
    if (!claimed || claim === undefined) {
      editorHandle?.setClaimGhost(null)
      return
    }
    const hint = claim.name === 'goal'
      ? tRef.current(hasGoal ? 'composer.hint.goal.active' : 'composer.hint.goal')
      : claim.name === 'plan'
        ? tRef.current('composer.hint.plan')
        : claim.hint ?? null
    editorHandle?.setClaimGhost(hint === null ? null : { token: claim.token, hint })
  }, [input.claim, input.phase, hasGoal, editorHandle])

  // Tool-row collapse measurement (the model pill's truncation ladder, host
  // parity): flips `data-model-compact` when the expanded controls cannot
  // share the line, which switches the pill to pure icon. The row exists on
  // every render of the card, so a mount-time observe is enough.
  useEffect(() => {
    const row = toolRowRef.current
    if (row === null) return undefined
    return observeControlRow(row)
  }, [])

  // Aligned with the built-in bar: busy phases read-only the surface so the
  // draft stays visible but cannot change under the in-flight submit.
  useEffect(() => {
    editorRef.current?.setEditable(!machineBusy)
  }, [machineBusy])

  // Mode and placeholder live in compartments, so a switch keeps undo
  // history and scroll; the choice persists across page loads.
  function toggleMode(): void {
    setMode((current) => {
      const next: EditMode = current === 'render' ? 'source' : 'render'
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, next)
      } catch {
        // Private-mode storage: the toggle still works for this page life.
      }
      return next
    })
  }

  // Keep the compartments in sync with locale switches, not just toggles.
  useEffect(() => {
    editorRef.current?.setMode(mode, placeholderOf(t, mode))
  }, [mode, t])

  const canSubmit = (hasText || input.attachmentIds.length > 0) && input.phase === 'plain' && !uploadsPending
  // Native canAcceptDrop parity: subagent === null, not locked (a session id
  // exists), not busy, and the intake face present.
  const canIntake = attachmentFace !== undefined && sessionId !== undefined
    && session?.subagent == null && !machineBusy

  // Both the `+` menu's file row and the fallback attach button ride the
  // same hidden input.
  const pickFiles = useCallback(() => { fileInputRef.current?.click() }, [])

  // File intake through the conversation service's own validation path; the
  // admitted state mutation rides the public addAttachments (a busy-phase
  // refusal releases the just-created drafts instead of leaking them).
  // Returns whether the intake was admitted — the paste seam consumes the
  // event only then, mirroring the paste handler's cancel-after-landing rule.
  function intakeFiles(files: readonly File[]): boolean {
    if (attachmentFace === undefined || sessionId === undefined || files.length === 0) return false
    if (session?.subagent != null || machineBusy) return false
    try {
      const drafts = attachmentFace.createDrafts(sessionId, files) as ComposerAttachment[]
      if (!inputActionsRef.current.addAttachments(drafts.map((draft) => draft.id))) {
        attachmentFace.releaseDraftAttachments(drafts)
        return false
      }
      return true
    } catch (error: unknown) {
      showBanner(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  function onPickFiles(event: ChangeEvent<HTMLInputElement>): void {
    const picked = event.target.files === null ? [] : [...event.target.files]
    // Reset so picking the same file again re-fires the change event.
    event.target.value = ''
    intakeFiles(picked)
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!canIntake) return
    event.preventDefault()
    setDragging(true)
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>): void {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragging(false)
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setDragging(false)
    intakeFiles([...event.dataTransfer.files])
  }

  function onRemoveAttachment(id: DraftAttachmentId): void {
    if (attachmentFace === undefined || machineBusy) return
    // The machine admits (not busy) and the release happens in the same tick,
    // so the descriptor cannot be orphaned by a race.
    inputActionsRef.current.removeAttachment(id)
    attachmentFace.releaseDraftAttachment(id)
  }

  function onRetryFile(id: DraftAttachmentId): void {
    if (attachmentFace === undefined || sessionId === undefined) return
    attachmentFace.retryFileUpload(sessionId, id)
  }

  function uploadState(id: DraftAttachmentId): ReactNode {
    const upload = uploads?.[id]
    if (upload === undefined || upload.status === 'ready') return null
    if (upload.status === 'error') {
      return (
        <span className={css.uploadError}>
          {t('composer.file.uploadFailed')}
          <button type="button" className={css.retryButton} onClick={() => { onRetryFile(id) }}>
            {t('composer.file.retry')}
          </button>
        </span>
      )
    }
    return <span className={css.uploadState}>{t('composer.file.uploading')}</span>
  }

  function attachmentChip(attachment: ComposerAttachment): ReactNode {
    return (
      <li key={attachment.id} className={css.attachment}>
        {attachment.kind === 'image'
          ? <img className={css.thumb} src={attachment.previewUrl} alt="" />
          : <span className={css.fileChip} aria-hidden>⌗</span>}
        <span className={css.attachmentName}>{attachment.file.name}</span>
        {attachment.kind === 'file' ? uploadState(attachment.id) : null}
        <button type="button" className={css.removeButton} aria-label={t('composer.attachment.remove')}
          title={t('composer.attachment.remove')} disabled={machineBusy}
          onClick={() => { onRemoveAttachment(attachment.id) }}>
          <IconCloseOutlineMedium size={12} />
        </button>
      </li>
    )
  }

  const otherMode: EditMode = mode === 'render' ? 'source' : 'render'

  return (
    // `data-composer-card` is the host card contract (the shared Toast
    // anchor and popup-dismissal marker); `data-markdown-composer` is ours.
    <div className={css.card} data-markdown-composer data-composer-card ref={cardRef}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {banner !== null && (
        <div key={banner.seq} className={css.banner} role="alert" data-markdown-banner>
          <IconWarningOutlineMedium size={14} />
          <span className={css.bannerText}>{banner.text}</span>
          <button type="button" className={css.bannerClose} aria-label={t('composer.notice.dismiss')}
            onClick={() => { setBanner(null) }}>
            <IconCloseOutlineMedium size={12} />
          </button>
        </div>
      )}
      {notice?.level === 'info' && (
        <div className={css.notice} role="status" data-markdown-notice>
          {notice.text}
        </div>
      )}
      {dragging && canIntake && (
        <div className={css.dropOverlay} data-markdown-dropzone>{t('composer.dropHere')}</div>
      )}
      {attachments.length > 0 && (
        <ul className={css.attachmentBar} data-markdown-attachments>
          {attachments.map(attachmentChip)}
        </ul>
      )}
      <div className={css.surface} data-markdown-surface ref={surfaceRef} />
      <div className={css.toolRow} ref={toolRowRef}>
        {/* Command-menu face (tool row ①): the `+` trigger and its rebuilt
            MenuView over the host command catalog. Probed and gated like the
            other faces; its fallback keeps the legacy attach button alive so
            file intake never disappears with the menu. The hidden file input
            is shared by both and exists whenever the attachment face does. */}
        <FaceGate
          definition={commandFaceDefinition()}
          fallback={attachmentFace !== undefined && (
            <button type="button" className={css.iconButton} aria-label={t('composer.attach')}
              title={t('composer.attach')} disabled={!canIntake}
              onClick={pickFiles}>
              <IconPaperclipOutlineMedium size={14} />
            </button>
          )}
        >
          <CommandMenuFace
            sessionId={sessionId}
            t={t}
            editor={editorHandle}
            container={cardRef}
            canPickFiles={canIntake}
            onPickFiles={pickFiles}
            onError={showBanner}
            registerClose={registerMenuClose}
          />
        </FaceGate>
        {attachmentFace !== undefined && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={session?.subagent != null}
            hidden
            onChange={onPickFiles}
          />
        )}
        {/* Permission preset face (tool row ②): projection-driven pill +
            preset popup + risk gate, probed and gated independently — a
            probe miss or a mid-life degrade hides this face alone. */}
        <FaceGate definition={permissionFaceDefinition(useProjection)}>
          <PermissionSelectFace
            useProjection={useProjection}
            sessionId={sessionId}
            t={t}
            locked={sessionId === undefined}
            onError={showBanner}
          />
        </FaceGate>
        {/* Action semantics: the button names the mode it switches TO. */}
        <button type="button" className={css.modeButton} onClick={toggleMode}
          title={t('composer.mode.toggle', { mode: labelOf(t, otherMode) })}>
          {labelOf(t, otherMode)}
        </button>
        <span className={css.spring} />
        {/* Model/reasoning face (tool row ③): the vendored host ModelSelect
            over the host `modelDirectories` data plane, right-aligned before
            the submit action like the native seat. Probed and gated like the
            permission face; busy phases never lock the model seat. */}
        <FaceGate definition={modelFaceDefinition()}>
          <ModelSelectFace
            sessionId={sessionId}
            locked={sessionId === undefined}
            subagent={session?.subagent ?? null}
          />
        </FaceGate>
        <button type="button" className={css.submitButton} disabled={!canSubmit} onClick={submit}>
          {t('composer.action.submit')}
        </button>
      </div>
    </div>
  )
}
