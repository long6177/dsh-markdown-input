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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, ReactNode } from 'react'
import {
  IconCloseOutline16, IconPaperclipOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ComposerAttachment, DraftAttachmentId,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MarkdownComposer.module.css'
import {
  conversationFace, noticesOf, useObservable,
} from './conversation-face.ts'
import { createMarkdownEditor, type EditMode, type MarkdownEditorHandle } from './markdown-editor.ts'
import { NS } from './locales.ts'

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
export function MarkdownComposer({ useInput, inputActions, t, sessionId, session }: MarkdownComposerProps) {
  const input = useInput((state) => state)
  const conversation = conversationFace()
  const [mode, setMode] = useState<EditMode>(storedMode)
  const [hasText, setHasText] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [banner, setBanner] = useState<{ seq: number; text: string } | null>(null)
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
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
  const uploads = useObservable(conversation?.fileUploads)

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

  const attachments = useMemo(
    () => conversation === undefined ? [] : conversation.resolveDraftAttachments(input.attachmentIds),
    [conversation, input.attachmentIds],
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
    if (conversation === undefined) return
    if (attachments.length !== input.attachmentIds.length) {
      inputActions.pruneAttachments(attachments.map((attachment) => attachment.id))
    }
  }, [conversation, attachments, input.attachmentIds, inputActions])

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
    const editor = createMarkdownEditor({
      parent: surface,
      placeholder: '',
      mode: storedMode(),
      onSubmit: submit,
      onDocChange: (text) => {
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
    editorRef.current = editor
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
  const canIntake = conversation !== undefined && session?.subagent == null && !machineBusy

  // File intake through the conversation service's own validation path; the
  // admitted state mutation rides the public addAttachments (a busy-phase
  // refusal releases the just-created drafts instead of leaking them).
  function intakeFiles(files: readonly File[]): void {
    if (conversation === undefined || sessionId === undefined || files.length === 0) return
    if (session?.subagent != null || machineBusy) return
    try {
      const drafts = conversation.createDrafts(sessionId, files)
      if (!inputActionsRef.current.addAttachments(drafts.map((draft) => draft.id))) {
        conversation.releaseDraftAttachments(drafts)
      }
    } catch (error: unknown) {
      showBanner(error instanceof Error ? error.message : String(error))
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
    if (conversation === undefined || machineBusy) return
    // The machine admits (not busy) and the release happens in the same tick,
    // so the descriptor cannot be orphaned by a race.
    inputActionsRef.current.removeAttachment(id)
    conversation.releaseDraftAttachment(id)
  }

  function onRetryFile(id: DraftAttachmentId): void {
    if (conversation === undefined || sessionId === undefined) return
    conversation.retryFileUpload(sessionId, id)
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
          <IconCloseOutline16 size={12} />
        </button>
      </li>
    )
  }

  const otherMode: EditMode = mode === 'render' ? 'source' : 'render'

  return (
    <div className={css.card} data-markdown-composer
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {banner !== null && (
        <div key={banner.seq} className={css.banner} role="alert" data-markdown-banner>
          <IconWarningOutline16 size={14} />
          <span className={css.bannerText}>{banner.text}</span>
          <button type="button" className={css.bannerClose} aria-label={t('composer.notice.dismiss')}
            onClick={() => { setBanner(null) }}>
            <IconCloseOutline16 size={12} />
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
      <div className={css.toolRow}>
        {/* Action semantics: the button names the mode it switches TO. */}
        <button type="button" className={css.modeButton} onClick={toggleMode}
          title={t('composer.mode.toggle', { mode: labelOf(t, otherMode) })}>
          {labelOf(t, otherMode)}
        </button>
        {conversation !== undefined && (
          <>
            <button type="button" className={css.iconButton} aria-label={t('composer.attach')}
              title={t('composer.attach')} disabled={!canIntake}
              onClick={() => { fileInputRef.current?.click() }}>
              <IconPaperclipOutline16 size={14} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={session?.subagent != null}
              hidden
              onChange={onPickFiles}
            />
          </>
        )}
        <span className={css.spring} />
        <button type="button" className={css.submitButton} disabled={!canSubmit} onClick={submit}>
          {t('composer.action.submit')}
        </button>
      </div>
    </div>
  )
}
