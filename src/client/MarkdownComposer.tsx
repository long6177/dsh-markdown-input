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
 * bar. The stop semantics (#32) mirror the native bar's arms: on a running
 * ordinary session the primary names stop while the composer is empty or
 * owner-blocked and cancels the in-flight turn (queue preserved); a running
 * continuable child keeps Send primary and gains a dedicated stop button.
 *
 * The tool row is a federation of faces: the `+` command menu (T5), the
 * rebuilt permission preset selector (T3) and the vendored model/reasoning
 * selector (T4) mount inside their own FaceGates and read the host's
 * command-catalog, permission, and model data planes (command-face.ts,
 * permission-face.ts, model-face.ts) — a probe miss or a mid-life degrade
 * hides that face alone, the text face and the rest of the row stay. When
 * the command menu face is unavailable the legacy attach button takes its
 * place, so file intake never disappears with the menu. The plan chip
 * (issue #34) rebuilds the native `conversation.input.plan` seat the
 * takeover replaces, beside the permission face like the native row; the
 * goal strip (issue #34) rebuilds the native GoalDock the takeover hides
 * with the whole fallback bar, and the todo panel (issue #38) rebuilds the
 * native TodoDock the same way — above the goal strip, the native dock
 * order (todo 0, goal 10, queue 20).
 *
 * The card root is the native bar's two-tier shape (issue #43): the bordered
 * card face, then a dock row directly below it holding the rebuilt stats
 * pills (issue #43's alpha.13 round) and the rebuilt ContextMeter. The host
 * mounts `conversation.composer.dock` only from inside its InputBar — the
 * slot whose order-0 occupant is the native StatsPills — so during a takeover
 * that slot never renders and both faces ride the card's own row instead —
 * the native below-the-card position and order (pills first), mirrored
 * geometry.
 *
 * The runtime placeholders follow the native bar's ladder
 * (`placeholder.steerQueue` / `placeholder.plan` over the card's own
 * render/source copy).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, MouseEvent, ReactNode } from 'react'
import {
  IconCloseOutlineMedium, IconCodeOutlineRegular, IconPaperclipOutlineMedium,
  IconWarningOutlineMedium, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ComposerAttachment, DraftAttachmentId,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MarkdownComposer.module.css'
import { AgentPresetFace, agentPresetFaceDefinition } from './AgentPresetFace.tsx'
import { agentPresetLocale, agentPresetsRemoteFace } from './agent-preset-face.ts'
import { resolveAgentPresetCopy } from './agent-preset-core.ts'
import { CommandMenuFace } from './CommandMenuFace.tsx'
import { commandFaceDefinition } from './command-face.ts'
import { CompletionFace, completionFaceDefinition } from './CompletionFace.tsx'
import type { CompletionGuard } from './completion-core.ts'
import { contextLocale } from './context-meter-face.ts'
import { ContextMeterFace, contextMeterFaceDefinition, type ContextMeterFaceProps } from './ContextMeterFace.tsx'
import { observeControlRow } from './control-row.ts'
import { fallbackToNative } from './degrade.ts'
import {
  attachmentFace as detectAttachmentFace, composerBlockOf, conversationFace, noticesOf,
  queueUpdateOf, stopOf, useObservable,
  type AttachmentFace,
} from './conversation-face.ts'
import { registerFace } from './face.ts'
import { FaceGate } from './FaceGate.tsx'
import { GoalStripFace, goalStripFaceDefinition } from './GoalStripFace.tsx'
import { createMarkdownEditor, type EditMode, type MarkdownEditorHandle } from './markdown-editor.ts'
import { NS } from './locales.ts'
import { modelFaceDefinition } from './model-face.ts'
import { ModelSelectFace } from './ModelSelectFace.tsx'
import { permissionFaceDefinition } from './permission-face.ts'
import { PermissionSelectFace } from './PermissionSelectFace.tsx'
import { PlanChipFace, planFaceDefinition } from './PlanChipFace.tsx'
import { planChipVisible, planProjectionOf } from './plan-core.ts'
import { QueueFace } from './QueueFace.tsx'
import { queueMutableOf, queueViewRows } from './queue-core.ts'
import { skillFace } from './skill-face.ts'
import {
  resolveStatsCopy, type StatsPillsCopy,
} from './stats-pills-core.ts'
import {
  statsLocale,
} from './stats-pills-face.ts'
import { StatsPillsFace, statsPillsFaceDefinition, type StatsPillsFaceProps } from './StatsPillsFace.tsx'
import { dedicatedStopOf, primaryStopsOf } from './stop-core.ts'
import { TodoStripFace, todoStripFaceDefinition } from './TodoStripFace.tsx'
import {
  addWorkspaceEntry, addWorkspaceIsOnlyEntry, resolveAddWorkspaceCopy,
  workspaceLabelState, workspaceMenuItems, workspaceRowSupported, workspaceTriggerPosture,
  type WorkspaceRowSnapshot,
} from './workspace-row-core.ts'
import { workspaceAddFace, workspaceAddLocale } from './workspace-add.ts'
import { workspaceVerbFace } from './workspace-verb.ts'
import { WorkspaceRowFace } from './WorkspaceRowFace.tsx'

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

/**
 * The session list read the workspace chip's cwd bridge needs (issue #42,
 * level 4 of the native label chain). `useSessions` is a GLOBAL standard
 * seat (ui-session's `provideRoot` contribution,
 * `ui-session/src/client/index.ts:672-680`), so the renderer materializes it
 * into every session-scope entry — the same way it materializes
 * `useWorkspaces` (ui-workspace's contribution). Structural on purpose: the
 * composer chain props type carries the owner share, and this narrowed shape
 * pins exactly the two fields the chip reads.
 */
interface SessionsStandardSeat {
  readonly byId: Record<string, { readonly cwd?: string | undefined } | undefined>
}

/**
 * The host `conversation` namespace keys the workspace row reads: the chip's
 * accessible name and placeholder and the picker rows' shared default name.
 * All three come from a dictionary this plugin does not own
 * (`ui-conversation/src/client/locales.ts:24,79`; `workspace.defaultName`
 * lives in the shared `common` vocabulary the namespace-bound translate
 * consults after its own miss). The row therefore registers NO dictionary and
 * invents no words: apply binds `conversation` once (the context-meter
 * binding, reused) and `workspace` beside it for the picker's status line.
 */
export type WorkspaceCopyKey =
  | 'hero.chooseWorkspace'
  | 'placeholder.workspace'
  | 'workspace.defaultName'

/** The workspace row's `conversation` translate seat, narrowed to the keys above. */
type WorkspaceConversationTranslate = Translate<WorkspaceCopyKey>

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
 * Elements that own the pointer gesture themselves. A mousedown inside one of
 * them must not be turned into an editor focus — that is the whole point of
 * the guard: tool-row buttons, the `+` menu's and the completion popups' items
 * and containers (the popups portal INTO the card root, so their mousedowns
 * bubble here), attachment chips and the goal/queue editors and their
 * controls keep their behavior. The container roles matter as much as the
 * item roles: a mousedown on a popup's own padding must not dismiss it by
 * pulling focus back to the editor.
 */
const INTERACTIVE_SELECTOR = [
  'button', 'input', 'textarea', 'a', 'select', '[contenteditable]',
  '[role="button"]', '[role="menuitem"]', '[role="option"]', '[role="combobox"]',
  '[role="menu"]', '[role="menubar"]', '[role="listbox"]', '[role="dialog"]',
].join(', ')

/**
 * Whether a mousedown on the card may focus the editor (issue #41): the card
 * root now carries the pointer so that a click on its padding or on a strip
 * gap lands in the text face, the way the native card behaves. Clicks inside
 * the editor's own contentDOM (or any other editable surface) already place
 * the caret through CodeMirror/native focus, and clicks on an interactive
 * element must keep their own behavior, so both are excluded.
 * @param target - the event target, if it is a node.
 * @param contentDom - the editor's contentDOM (null before the editor mounts).
 * @returns Whether the card should focus the editor for this mousedown.
 */
export function shouldFocusEditorFromCard(
  target: EventTarget | null,
  contentDom: HTMLElement | null,
): boolean {
  if (!(target instanceof Element)) return false
  if (contentDom !== null && contentDom.contains(target)) return false
  return target.closest(INTERACTIVE_SELECTOR) === null
}

/**
 * The taken-over composer card.
 * @param props - chain election marker plus standard session input props and copy.
 * @returns The composer replacement card.
 */
export function MarkdownComposer({
  useInput, inputActions, useProjection, t, sessionId, session, useWorkspaces, useSessions,
}: MarkdownComposerProps & {
  /**
   * Chain props this entry reads with a widened shape. The owner share is
   * typed as `ComposerChainProps`, so the global standard seats the renderer
   * merges in (`useWorkspaces` from ui-workspace, `useSessions` from
   * ui-session) are declared here structurally and default to undefined on a
   * composition that never contributed them — the row then hides whole.
   */
  readonly useWorkspaces?: ((selector: (state: WorkspaceRowSnapshot) => unknown) => unknown) | undefined
  readonly useSessions?: ((selector: (state: SessionsStandardSeat) => unknown) => unknown) | undefined
}) {
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
  const [banner, setBanner] = useState<{
    seq: number
    text: string
    /** Optional recovery action (the add flow's native `folderError.retry` arm). */
    action?: { label: string; run: () => void } | undefined
  } | null>(null)
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
  // the document changes (the host pipeline's trigger-track loss). The open
  // state rides the same seams: onOpen announces the open, the wrapped close
  // verb announces the close — the native canSteerQueue's `!commandMenuOpen`
  // arm reads it.
  const menuCloseRef = useRef<(() => void) | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const registerMenuClose = useCallback((close: (() => void) | null) => {
    menuCloseRef.current = close === null
      ? null
      : () => {
        setMenuOpen(false)
        close()
      }
  }, [])
  // The completion popups (T10) register theirs here; the card closes them
  // when the `+` menu opens — one candidate surface above the card, the
  // native pipeline's single-MenuView semantics in both directions.
  const completionCloseRef = useRef<(() => void) | null>(null)
  const registerCompletionClose = useCallback((close: (() => void) | null) => {
    completionCloseRef.current = close
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
  const showBanner = useCallback((text: string, action?: { label: string; run: () => void }) => {
    bannerSeq.current += 1
    setBanner({ seq: bannerSeq.current, text, action })
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

  // Queue strip (issue #30): the queued-message view the native dock keeps
  // in the fallback bar, which the takeover hides. Rows ride the input
  // currency's `queue` (the facade overlays the agent inbox) plus the
  // session snapshot's pendingSubmissions echoes; mutations ride the
  // session-scoped conversation verb, capability-detected per call —
  // without it the strip keeps rendering, minus its action buttons.
  const queueUpdate = sessionId === undefined ? undefined : queueUpdateOf(sessionId)
  const queueRows = useMemo(
    () => queueViewRows(input.queue, session?.pendingSubmissions ?? []),
    [input.queue, session?.pendingSubmissions],
  )
  const queueMutable = queueMutableOf(session?.subagent)

  // Stop arms (issue #32): the native bar's send/stop semantics over the
  // card's planes. The cancel verb rides the session-scoped conversation
  // service (the native stop inject's resolution), capability-detected per
  // call — without it the stop buttons render disabled, the seat never
  // disappears. The blocked plane rides the conversation service's blocks
  // registry (the native bar's `blocked` read); hosts without it read as
  // unblocked and the empty-composer arm stands alone.
  const stop = sessionId === undefined ? undefined : stopOf(sessionId)
  const blockSource = useMemo(
    () => conversation !== undefined && sessionId !== undefined
      ? composerBlockOf(conversation, sessionId)
      : undefined,
    [conversation, sessionId],
  )
  const composerBlock = useObservable(blockSource)
  const draftEmpty = !hasText && input.attachmentIds.length === 0
  const stopConditions = {
    // No session id, no session-scoped verb: the arms stay off entirely.
    running: sessionId !== undefined && (session?.running ?? false),
    subagent: session?.subagent,
    empty: draftEmpty,
    blocked: composerBlock !== undefined,
  }
  const primaryStops = primaryStopsOf(stopConditions)
  const dedicatedStop = dedicatedStopOf(stopConditions)

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

  // The stop arms' click: the session-scoped cancel verb (queue preserved;
  // a failed cancel surfaces through the Session promptError — see stopOf).
  function stopRunning(): void {
    stop?.()
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
    const entries = skills !== undefined && sessionId !== undefined
      ? skillLexicon?.value.get(sessionId)
      : undefined
    editorHandle?.setSkillLexicon((entries ?? []).map((entry) => entry.name))
  }, [skills, sessionId, skillLexicon, editorHandle])

  // Claim ghost hint (T9): the native claim decoration — while a command
  // claim holds, the resolved per-command hint (the translated native key
  // wins, the machine's own hint answers for other claimed commands) rides
  // into the editor, which decides blank-args from its live document.
  const hasGoal = useProjection('goal', (goal: unknown) => goal != null) === true
  // The plan mode's folded target (issue #34, native InputBar parity): the
  // same value the plan chip and the native `placeholder.plan` read. The
  // `plan` key is declared by the host's plan-mode plugin, whose client
  // types sit outside this build's dependency graph (the `goal` and
  // `permissions` merges reach us transitively through the linked
  // conversation types), so the keyed hook widens structurally here.
  const readPlanProjection = useProjection as unknown as
    (key: 'plan') => unknown
  const planState = planProjectionOf(readPlanProjection('plan'))
  const planActive = planChipVisible(planState)
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

  // ------------------------------------------------------------------
  // Workspace row + trigger posture (issue #42, ADR-0006 option B)
  // ------------------------------------------------------------------
  // A new conversation is a BLANK session, and the chain's `overlay: true`
  // election hides the whole fallback bar the native `heroWorkspaceRow` lives
  // in — so the card rebuilds that row's two seats. The row is blank-session
  // only, exactly like the native hero, and every piece of its data is read
  // through the same standard seats the native row reads:
  const workspaces = (typeof useWorkspaces === 'function'
    ? useWorkspaces((state) => state)
    : undefined) as WorkspaceRowSnapshot | undefined
  const sessionCwd = typeof useSessions === 'function'
    ? useSessions((state) => sessionId === undefined ? undefined : state.byId[sessionId]?.cwd)
    : undefined
  const workspaceVerb = workspaceVerbFace()
  // The row owns the trigger posture, so its capability verdict is also the
  // card's: without the list hook, the copy, or the reuse-or-create verb there
  // is no pick surface to trigger and the card must stay exactly as it is
  // today (an ordinary editable composer).
  const workspaceCopy = contextLocale() as WorkspaceConversationTranslate | undefined
  const blank = session?.blank === true
  const rowSupported = workspaceRowSupported({
    sessionId,
    blank,
    hookPresent: workspaces !== undefined,
    verbPresent: workspaceVerb !== undefined,
  }) && workspaceCopy !== undefined
  const workspaceItems = workspaces?.items ?? []
  const sessionWorkspace = workspaceItems.find(item => sessionId !== undefined && item.sessionIds.includes(sessionId))
  // The pending pick (the native `pendingWorkspaceId`): the label reads back
  // the just-clicked Workspace's title instead of flashing the old/absent one
  // while the host connects. Cleared by the effect below on two triggers — the
  // session landed in it, or a ready list no longer carries it (deleted).
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pendingWorkspace = pendingWorkspaceId === undefined
    ? undefined
    : workspaceItems.find(item => item.workspaceId === pendingWorkspaceId)
  useEffect(() => {
    if (pendingWorkspaceId === undefined) return
    if (sessionWorkspace?.workspaceId === pendingWorkspaceId
      || (workspaces?.phase === 'ready' && pendingWorkspace === undefined)) {
      setPendingWorkspaceId(undefined)
    }
  }, [pendingWorkspaceId, sessionWorkspace?.workspaceId, workspaces?.phase, pendingWorkspace])
  const rowLabel = rowSupported
    ? workspaceLabelState({
      sessionId,
      sessionWorkspace,
      pendingWorkspace,
      cwd: sessionCwd,
      phase: workspaces?.phase ?? 'pending',
      localizedDefaultTitle: workspaceCopy?.('workspace.defaultName') ?? '',
    })
    : undefined
  // The native `inert` formula (`ConversationContent.tsx:141`): a blank session
  // whose chip resolved no title turns the whole card into the picker.
  const triggerPosture = rowSupported && workspaceTriggerPosture({ blank, label: rowLabel })
  const openPicker = useCallback(() => { setPickerOpen(true) }, [])
  const closePicker = useCallback(() => { setPickerOpen(false) }, [])
  // Native pick semantics: the card's blank session IS the session being moved,
  // so the reuse-or-create flow is the whole verb — no draft transfer (that is
  // `selectWorkspace`'s job for a non-blank session with something to carry).
  const pickWorkspace = useCallback((workspaceId: string) => {
    setPickerOpen(false)
    setPendingWorkspaceId(workspaceId)
    if (workspaceVerb === undefined) return
    try {
      workspaceVerb.startSession(workspaceId)
    } catch (error: unknown) {
      setPendingWorkspaceId(undefined)
      showBanner(error instanceof Error ? error.message : String(error))
    }
  }, [workspaceVerb, showBanner])

  // The add-workspace flow (issue #42, alpha.13 retest): the menu footer's
  // "add workspace" row adopts a NEW directory as a Workspace and picks it —
  // the native `WorkspacePickFlow`'s two moves (`pickDirectory` then
  // `create`, WorkspacePicker.tsx:141-146 + :131-139) reached directly
  // through the host verbs; no directory-flow hole is needed. The row itself
  // is present exactly when both verbs probe (face rule: a half-reachable
  // flow hides whole); the copy is the host `workspace` namespace's own words
  // with the plugin's verbatim fallback under a miss.
  const addVerb = workspaceAddFace()
  const addCopy = resolveAddWorkspaceCopy(workspaceAddLocale(), {
    'menu.addWorkspace': t('workspace.menu.addWorkspace'),
    'folderError.title': t('workspace.folderError.title'),
    'folderError.retry': t('workspace.folderError.retry'),
  })
  // Native `flowBusy` (WorkspacePicker.tsx:88): one flow at a time — from the
  // OS picker opening until the adoption settles, the add row is disabled.
  // The ref mirrors the state so the flow's own guard reads the CURRENT fact
  // (a retry action captured earlier must not consult a stale closure value).
  const [addBusy, setAddBusy] = useState(false)
  const addBusyRef = useRef(false)
  const runAddFlow = useCallback(async (): Promise<void> => {
    if (addVerb === undefined || addBusyRef.current) return
    addBusyRef.current = true
    setAddBusy(true)
    try {
      const path = await addVerb.pickDirectory()
      // Cancelled: the native flow just closes (`onCancel`), no error.
      if (path === null || path === '') return
      const created = await addVerb.createWorkspace({ path })
      // The native `adoptDirectory` tail: onPick(workspace.workspaceId) —
      // here the same reuse-or-create pick the rows use, so the session
      // lands in the new Workspace.
      pickWorkspace(created.workspaceId)
    } catch (error: unknown) {
      // The native folder-error dialog (title + message, `folderError.retry`
      // button — WorkspacePicker.tsx:204-219) mirrored onto the card's one
      // error surface: the banner, with the retry action beside the text.
      showBanner(
        `${addCopy['folderError.title']}: ${error instanceof Error ? error.message : String(error)}`,
        { label: addCopy['folderError.retry'], run: () => { void runAddFlow() } },
      )
    } finally {
      addBusyRef.current = false
      setAddBusy(false)
    }
  }, [addVerb, pickWorkspace, showBanner, addCopy['folderError.title'], addCopy['folderError.retry']])
  // The native "add is the only entry" edge (WorkspacePicker.tsx:157-162):
  // nothing listed, the list settled, and the flow reachable — a menu would
  // offer nothing to choose between, so the anchor gesture (chip or the
  // whole-card trigger click) IS the action: the open request is consumed
  // (the menu never shows) and the directory flow opens directly.
  const addIsOnlyEntry = addWorkspaceIsOnlyEntry({
    addPresent: addVerb !== undefined,
    phase: workspaces?.phase ?? 'pending',
    itemCount: workspaceItems.length,
  })
  useEffect(() => {
    if (pickerOpen && addIsOnlyEntry && !addBusy) {
      setPickerOpen(false)
      void runAddFlow()
    }
  }, [pickerOpen, addIsOnlyEntry, addBusy, runAddFlow])
  const addRow = addVerb === undefined || !rowSupported
    ? undefined
    : addWorkspaceEntry(addCopy['menu.addWorkspace'], addBusy)

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
  // draft stays visible but cannot change under the in-flight submit. The
  // workspace trigger posture (#42) joins it — the native `cardWorkspaceTrigger`
  // card is not an input until a workspace resolves, and the placeholder below
  // says what the click does instead.
  useEffect(() => {
    editorRef.current?.setEditable(!machineBusy && !triggerPosture)
  }, [machineBusy, triggerPosture])

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
  // The placeholder follows the native bar's runtime ladder (issue #34):
  // steering a queue while running wins over plan mode, plan mode wins over
  // the card's own render/source copy — the native formula verbatim,
  // including the open `+` menu's suppression arm and the queue rows'
  // `placement === 'queued'` wire test. (The native ladder's earlier arms —
  // workspace picker, block reason, offline parent — ride states the card
  // does not model.)
  const canSteerQueue = sessionId !== undefined && !machineBusy && draftEmpty
    && (session?.running ?? false) && session?.subagent == null && !menuOpen
    && input.queue.some((row) => (row as { readonly placement?: unknown }).placement === 'queued')
  // The native placeholder ladder's FIRST arm (#42): while the card is the
  // workspace picker, `placeholder.workspace` outranks every steering/plan/
  // render arm — the surface is not an editor then, it is the pick target.
  const placeholderText = triggerPosture
    ? workspaceCopy?.('placeholder.workspace') ?? placeholderOf(t, mode)
    : canSteerQueue
      ? t('composer.placeholder.steerQueue')
      : planActive
        ? t('composer.placeholder.plan')
        : placeholderOf(t, mode)
  useEffect(() => {
    editorRef.current?.setMode(mode, placeholderText)
  }, [mode, placeholderText])

  const canSubmit = !draftEmpty && input.phase === 'plain' && !uploadsPending
  // Native canAcceptDrop parity: subagent === null, not locked (a session id
  // exists), not busy, and the intake face present.
  const canIntake = attachmentFace !== undefined && sessionId !== undefined
    && session?.subagent == null && !machineBusy

  // Both the `+` menu's file row and the fallback attach button ride the
  // same hidden input.
  const pickFiles = useCallback(() => { fileInputRef.current?.click() }, [])

  // Input-phase guard for the completion popups (T10, host TriggerGuard):
  // busy admission phases freeze both triggers; a held command claim
  // suppresses `/` while `@` stays live.
  const completionGuard: CompletionGuard = machineBusy
    ? 'frozen'
    : input.phase === 'claimed' ? 'claimed' : 'plain'
  // The popup interlock verbs: opening either candidate surface closes the
  // other (the native pipeline's single MenuView, in both directions). The
  // `+` menu's open also flips the placeholder's steering arm off.
  const closeCommandMenu = useCallback(() => { menuCloseRef.current?.() }, [])
  const closeCompletionPopups = useCallback(() => { completionCloseRef.current?.() }, [])
  const handleMenuOpen = useCallback(() => {
    setMenuOpen(true)
    closeCompletionPopups()
  }, [closeCompletionPopups])

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

  /**
   * Card-level hit area (issue #41): the stretched contentDOM covers the
   * scroller band now, but the card's own padding and the gaps between the
   * strips are still outside it. A mousedown there focuses the editor through
   * the handle's public surface — never CodeMirror internals. No
   * `preventDefault`: native text selection inside the editor (and the drag
   * gestures that start on the card) must survive untouched.
   *
   * In the workspace trigger posture (#42) a card mousedown must NOT pull
   * focus back into a surface that is not an editor: the native
   * `cardWorkspaceTrigger` card is one pick target, and its click opens the
   * picker. This is the explicit guard the ticket asked for against breaking
   * the #41 hit area on the way in.
   */
  function onCardMouseDown(event: MouseEvent<HTMLDivElement>): void {
    if (triggerPosture) return
    if (!shouldFocusEditorFromCard(event.target, editorRef.current?.view.contentDOM ?? null)) return
    editorRef.current?.focus()
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
  // The agent-preset seat's copy (issue #42, alpha.12 feedback): the HOST
  // `settings.agentPreset` dictionary owns the shipped presets' words AND the
  // seat's three strings, so the bound seat is read per render here and the
  // fold prefers it — the plugin's `agentPreset.*` keys stay as the fallback
  // for a host build without the ui-agent-preset namespace.
  const agentPresetT = agentPresetLocale()
  const agentPresetCopy = resolveAgentPresetCopy(agentPresetT, {
    seatHint: t('agentPreset.hint'),
    noDescription: t('agentPreset.noDescription'),
    switchRefused: t('agentPreset.switchRefused'),
  })
  const agentPresetsRemote = agentPresetsRemoteFace()
  // The below-card meter's copy (issue #43): the same `conversation` seat the
  // workspace row reads, read per render here. The FaceGate's probe re-checks
  // the binding (registerFace latches per id, so a first render before apply's
  // bind latches only its own verdict — the gate renders nothing, never a
  // seat without words); the conjunction keeps TypeScript honest without a
  // cast.
  const contextMeterT = contextLocale()
  // The dock pills' copy (issue #43, alpha.13): the HOST `chat` namespace's
  // own keys through the bound seat, the plugin's verbatim fallback lines
  // under a miss or an unbound namespace. The dialog keys (issue #43's third
  // round) ride the same fold.
  const statsCopy: StatsPillsCopy = resolveStatsCopy(statsLocale(), {
    counts: t('stats.counts'),
    cacheHit: t('stats.cacheHit'),
    dialogTitle: t('stats.dialog.title'),
    dialogUsageTitle: t('stats.dialog.usageTitle'),
    dialogLlmTime: t('stats.dialog.llmTime'),
    dialogToolTime: t('stats.dialog.toolTime'),
    dialogTtft: t('stats.dialog.ttft'),
    dialogSpeed: t('stats.dialog.speed'),
    tokensPerSecond: t('message.tokensPerSecond'),
    turnUsageCount: t('message.turnUsage.count'),
    turnUsageCacheHit: t('message.turnUsage.cacheHit'),
    turnUsageInput: t('message.turnUsage.input'),
    turnUsageCacheRead: t('message.turnUsage.cacheRead'),
    turnUsageCacheWrite: t('message.turnUsage.cacheWrite'),
    turnUsageOutput: t('message.turnUsage.output'),
    compactSeconds: t('duration.compactSeconds'),
    compactMinutes: t('duration.compactMinutes'),
    thousand: t('number.thousand'),
    million: t('number.million'),
    groupSeparator: t('number.groupSeparator'),
  })

  return (
    // The card root is the native bar's own two-tier shape (issue #43): the
    // bordered card face, then the dock row below it — where the native
    // InputBar renders its ContextMeter
    // (`ui-conversation/src/client/skeleton/InputBar.tsx:499-504`). The
    // `conversation.composer.dock` slot is mounted only from inside that
    // fallback bar, so an occupant on it can never show during a takeover;
    // the card renders the meter itself in the mirrored row.
    <div className={css.root}>
      {/* `data-composer-card` is the host card contract (the shared Toast
          anchor and popup-dismissal marker); `data-markdown-composer` is ours.
          The trigger posture (#42) mirrors the native `cardWorkspaceTrigger`
          contract: `data-workspace-trigger` for styling/tests, a card-level click
          that opens the pick menu, and a pointerdown stop so the Menu's
          outside-close listener cannot race the click's reopen (the native bar's
          own trick — close-then-open flickers the chip's open echo). The card-
          level mousedown hit area (#41) stays on the FACE: the dock row below
          is not editor surface. */}
      <div className={css.card} data-markdown-composer data-composer-card ref={cardRef}
        {...triggerPosture ? { 'data-workspace-trigger': '' } : {}}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onMouseDown={onCardMouseDown}
        onClick={triggerPosture ? openPicker : undefined}
        onPointerDown={triggerPosture ? (event) => { event.stopPropagation() } : undefined}>
        {banner !== null && (
          <div key={banner.seq} className={css.banner} role="alert" data-markdown-banner>
            <IconWarningOutlineMedium size={14} />
            <span className={css.bannerText}>{banner.text}</span>
            {/* Recovery action (the add flow's retry): the native folder-error
                dialog's `重新选择` button mirrored onto the card's one error
                surface — click dismisses the banner and re-opens the flow. */}
            {banner.action !== undefined && (
              <button type="button" className={css.bannerAction} data-markdown-banner-action
                onClick={() => {
                  setBanner(null)
                  banner.action?.run()
                }}>
                {banner.action.label}
              </button>
            )}
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
        {/* Hero row (issue #42, alpha.12 feedback): ONE flex line at the card
            top, the native `heroWorkspaceRow` mirrored — the workspace
            chip+menu and the preset seat are siblings of the same row
            container (gap 2px, align-items center), not two stacked card
            children. The row mounts whenever the row's capability verdict
            holds; a face whose gate is absent (roster service, projection
            key) leaves the line to the other seat instead of dangling. The
            row's two halves are still independent faces: the workspace chip
            (and the trigger posture it owns) hides whole when the list hook,
            the copy, or the reuse-or-create verb is missing, the preset seat
            when the roster or the projection is. */}
        {rowSupported && (
          <div className={css.heroRow} data-markdown-hero-row="">
            {rowSupported && workspaceCopy !== undefined && (
              <WorkspaceRowFace
                label={rowLabel}
                selectedWorkspaceId={pendingWorkspaceId ?? sessionWorkspace?.workspaceId}
                menuItems={workspaceMenuItems(workspaceItems, workspaceCopy('workspace.defaultName'))}
                open={pickerOpen && !addIsOnlyEntry}
                onToggleMenu={() => { setPickerOpen(value => !value) }}
                onCloseMenu={closePicker}
                onPick={pickWorkspace}
                onAdd={() => { void runAddFlow() }}
                addRow={addRow}
                triggerPosture={triggerPosture}
                copy={{ choose: workspaceCopy('hero.chooseWorkspace') }}
                testId="hero-workspace"
              />
            )}
            <FaceGate definition={agentPresetFaceDefinition(useProjection, agentPresetsRemote !== undefined)}>
              <AgentPresetFace
                useProjection={useProjection as unknown as (key: 'agentPreset') => unknown}
                sessionId={sessionId}
                remote={agentPresetsRemote}
                translate={agentPresetT}
                copy={agentPresetCopy}
                onError={showBanner}
              />
            </FaceGate>
          </div>
        )}
        {/* Todo panel (issue #38): the native TodoDock, the FIRST dock seat
            (order 0) the takeover hides with the whole fallback bar, rebuilt
            above the goal strip — the native dock order (todo 0, goal 10,
            queue 20). Probed and gated on the projection hook, the panel's one
            hard dependency; an absent `todos` key or an empty list renders
            nothing, never a dead seat. The key is widened structurally: the
            `todos` declaration lives in the todo tool package, outside this
            build's dependency graph (the `plan` key precedent). */}
        <FaceGate definition={todoStripFaceDefinition(useProjection)}>
          <TodoStripFace
            useProjection={(useProjection as unknown) as (key: 'todos') => unknown}
            t={t}
          />
        </FaceGate>
        {/* Goal strip (issue #34): the native GoalDock the takeover hides
            with the whole fallback bar (the `conversation.input.dock` strip
            renders inside the chain fallback), rebuilt above the queue strip
            — the native dock order (goal 10, queue 20). Probed and gated:
            the projection hook is the one hard dependency, the verb surfaces
            shed the strip's buttons alone. */}
        <FaceGate definition={goalStripFaceDefinition(useProjection)}>
          <GoalStripFace
            useProjection={useProjection}
            sessionId={sessionId}
            running={session?.running ?? false}
            t={t}
          />
        </FaceGate>
        <QueueFace
          rows={queueRows}
          mutable={queueMutable}
          running={session?.running ?? false}
          updateQueue={queueUpdate}
          t={t}
          onError={showBanner}
        />
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
          {/* The native row's two-group shape (issue #39, alpha.13 inversion):
              the seats ride in a leading and a trailing cluster, each ONE
              non-shrinking flex item (`flex: none`) — the layout premise the
              vendored measurement assumes. The previous flat row broke it
              from both ends: on overflow flex compressed the shrinkable face
              roots (`min-width: 0` pills), so the laid-out widths summed back
              to the available width and compact never fired on a tight row
              (the model name ellipsized instead); at width the `.spring`
              filler absorbed all the slack, so needed ≡ available and the
              verdict rode sub-pixel rounding (compact fired on wide rows).
              The group rules live in MarkdownComposer.module.css beside
              `.toolRow`. */}
          <div className={css.leading}>
            {/* Command-menu face (tool row ①): the `+` trigger and its rebuilt
                MenuView over the host command catalog. Probed and gated like the
                other faces; its fallback keeps the legacy attach button alive so
                file intake never disappears with the menu. The hidden file input
                is shared by both and exists whenever the attachment face does —
                it lives inside the group so the measured row sees only the two
                group children. */}
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
                onOpen={handleMenuOpen}
              />
            </FaceGate>
            {/* Completion popups (typed triggers, T10): the `/` command+skill
                popup and the `@` file-search popup over the CM6 surface,
                token-driven through the editor's probe seam. Probed and gated
                like the other faces — a probe miss hides the popups and typed
                text stays plain; per-trigger availability is checked inside
                (one data plane can die alone). */}
            <FaceGate definition={completionFaceDefinition()}>
              <CompletionFace
                sessionId={sessionId}
                t={t}
                editor={editorHandle}
                container={cardRef}
                guard={completionGuard}
                canPickFiles={canIntake}
                onPickFiles={pickFiles}
                onError={showBanner}
                registerClose={registerCompletionClose}
                onOpen={closeCommandMenu}
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
            {/* Plan chip (tool row, issue #34): the native PlanChip seat the
                takeover replaces, beside the access-mode select like the native
                row. Projection-driven; the exit rides the command face, so both
                surfaces gate the face — a probe miss hides the chip alone. */}
            <FaceGate definition={planFaceDefinition(useProjection)}>
              <PlanChipFace
                useProjection={readPlanProjection}
                sessionId={sessionId}
                locked={sessionId === undefined}
                t={t}
              />
            </FaceGate>
            {/* Action semantics: the copy names the mode it switches TO. The seat
                is plugin-invented (no native counterpart), so it stays a
                permanently icon-only toggle: text here is row budget the native
                row never spends, and that surplus is what folded the model pill
                to a pure icon (#39). The box rides the sibling icon triggers'
                22px footprint (4px padding + 14px glyph) — the smallest seat an
                invented control gets on this row. */}
            <button type="button" className={css.modeButton} onClick={toggleMode}
              aria-label={t('composer.mode.toggle', { mode: labelOf(t, otherMode) })}
              title={t('composer.mode.toggle', { mode: labelOf(t, otherMode) })}>
              <IconCodeOutlineRegular size={14} />
            </button>
          </div>
          <div className={css.trailing}>
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
            {/* Dedicated stop (tool row ④, native `interruptible`): a running
                continuable child keeps Send primary and stops through its own
                button — the native inline square glyph, disabled while the cancel
                verb is missing. Mutually exclusive with the primary stop arm. */}
            {dedicatedStop && (
              <button type="button" className={css.stopButton}
                aria-label={t('composer.action.stop')} title={t('composer.action.stop')}
                disabled={stop === undefined} onClick={stopRunning}>
                <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
                  <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                </svg>
              </button>
            )}
            {/* Send/stop semantics (native `primaryStops`): on a running ordinary
                session the primary names stop while the composer is empty or
                owner-blocked, and clicks cancel (queue preserved); every other
                state keeps the send action. A missing cancel verb disables the
                arm, never hides the seat. The seat itself is the native pure-icon
                circle — the arrow glyph while sending, the square while stopping
                — so the row spends the native demand width, not a text button's
                (issue #39). Tooltip and aria carry the same localized copy the
                text button used to. The host Tooltip clones its anchor (no
                wrapper element), so the seat stays a direct child of this
                group, and its bubble is fixed-position — out of flow, so a
                hover can never widen what the row measures (the transient
                latch candidate the alpha.13 note flagged). */}
            <Tooltip label={primaryStops ? t('composer.action.stop') : t('composer.action.submit')}
              side="top" delayMs={500}
              disabled={primaryStops ? stop === undefined : !canSubmit}>
              <button type="button" className={css.submitButton}
                aria-label={primaryStops ? t('composer.action.stop') : t('composer.action.submit')}
                disabled={primaryStops ? stop === undefined : !canSubmit}
                onClick={primaryStops ? stopRunning : submit}>
                {primaryStops ? (
                  <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
                    <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
                    <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
                  </svg>
                )}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      {/* The dock row (issue #43): the native bar's row order mirrored —
          the stats pills FIRST (the `conversation.composer.dock` slot's
          order-0 occupant, `ui-chat/src/client/apply.ts:284-288`), then the
          context meter (the bar's fixed sibling after the slot). The slot is
          mounted only from inside the hidden fallback bar, so both faces ride
          the card's own row. Native runtime parity note: the native bar hides
          the meter while its `conversation.input.activity` occupant is
          expanded (`InputBar.tsx:60,503` — a toolbar-width claim like the
          experimental voice input, not a running state). That occupant lives
          inside the hidden fallback bar and exposes no public seam, so the
          signal is unreachable here and the meter stays visible: a recorded
          deviation, harmless in a takeover that has no such toolbar.
          Probed and gated like every face: a probe miss or a render exception
          hides that face alone, and the row's CSS collapses when it stays
          empty. */}
      <div className={css.dock} data-markdown-dock>
        {/* Stats pills (issue #43, alpha.13): the native dock's FIRST
            occupant rebuilt. Gated like the native slot mount itself — the
            host renders the dock slot only on the composer variant
            (`InputBar.tsx:500`, `variant === 'composer'`), never on the hero
            form — so the pills stay off for a session-less card and a blank
            session (the hero analog), while the meter (ungated natively)
            stays. Probed and gated: a projection seat miss hides the face;
            per-pill data gates live inside (missing projections or a
            session without steps or tokens hide whole or part natively). */}
        {sessionId !== undefined && !blank && (
          <FaceGate definition={statsPillsFaceDefinition(useProjection)}>
            <StatsPillsFace
              useProjection={useProjection as unknown as StatsPillsFaceProps['useProjection']}
              copy={statsCopy}
            />
          </FaceGate>
        )}
        <FaceGate definition={contextMeterFaceDefinition(useProjection)}>
          {contextMeterT !== undefined && (
            <ContextMeterFace
              useProjection={useProjection as unknown as ContextMeterFaceProps['useProjection']}
              t={contextMeterT}
            />
          )}
        </FaceGate>
      </div>
    </div>
  )
}
