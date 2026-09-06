/**
 * The taken-over composer body: a CodeMirror 6 markdown surface (Obsidian-
 * style live rendering with a source-mode switch), the tool row, and submit.
 * Draft sync and submit ride the public inputActions face exactly as the v0
 * text face did; the editor owns the text between them.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MarkdownComposer.module.css'
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

const MODE_STORAGE_KEY = 'dsh-markdown-input.mode'

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
export function MarkdownComposer({ useInput, inputActions, t }: MarkdownComposerProps) {
  const input = useInput((state) => state)
  const [mode, setMode] = useState<EditMode>(storedMode)
  const [hasText, setHasText] = useState(false)
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const touchedRef = useRef(false)
  const seedingRef = useRef(false)
  // Refs mirroring the mutable faces so the editor (mounted once) always
  // reads the freshest session state without remounting.
  const inputRef = useRef(input)
  inputRef.current = input
  const inputActionsRef = useRef(inputActions)
  inputActionsRef.current = inputActions

  function submit(): void {
    const editor = editorRef.current
    if (editor === null || inputRef.current.phase !== 'plain') return
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
      },
    })
    editorRef.current = editor
    return () => {
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

  const canSubmit = (hasText || input.attachmentIds.length > 0) && input.phase === 'plain'
  const otherMode: EditMode = mode === 'render' ? 'source' : 'render'

  return (
    <div className={css.card} data-markdown-composer>
      <div className={css.surface} data-markdown-surface ref={surfaceRef} />
      <div className={css.toolRow}>
        {/* Action semantics: the button names the mode it switches TO. */}
        <button type="button" className={css.modeButton} onClick={toggleMode}
          title={t('composer.mode.toggle', { mode: labelOf(t, otherMode) })}>
          {labelOf(t, otherMode)}
        </button>
        <span className={css.spring} />
        <button type="button" className={css.submitButton} disabled={!canSubmit} onClick={submit}>
          {t('composer.action.submit')}
        </button>
      </div>
    </div>
  )
}
