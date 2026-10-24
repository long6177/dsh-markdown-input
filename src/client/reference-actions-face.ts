/**
 * The reference-chip activation plane (#75): the `references` object the
 * sent-text projection hands to its activatable chips — `{ openFile(path),
 * openSkill(name) }`, the native `projectUserText` fifth parameter's shape.
 *
 * - `openFile` is the native FileReference contract verbatim: the
 *   session-scoped sidebar address of the path (`fileAddressFor`), opened
 *   through the host `sidebarRight` controller SYNCHRONOUSLY — its throw is
 *   the failure signal, and the face never swallows it (the projection's
 *   retry dialog keys on the throw and replays the same open).
 * - `openSkill` mirrors the native skill source: the catalog is consulted
 *   for the entry's `SKILL.md` path (settled cache first, one shared fetch
 *   otherwise), a pathless entry opens nothing (the native no-action rule
 *   for providers that ship no path), and a navigation failure is logged
 *   rather than thrown through the click handler — the skill chip has no
 *   retry dialog to route it into.
 *
 * The object composes the capability-detected faces per call: a host
 * without the sidebar-right plane (or without a session to address paths
 * in) degrades it to `undefined`, and every chip stays a display-only span.
 */
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { sessionSnapshot } from './sessions-face.ts'
import { sidebarRightFace } from './sidebar-right-face.ts'
import { skillFace, type SkillEntry } from './skill-face.ts'
import type { SessionId } from './conversation-face.ts'

/** The preview actions the projection's activatable chips call. */
export interface ReferenceActions {
  /**
   * Open or reveal a file in the right Sidebar using the session's
   * authority.
   * @param path - decoded path from the reference.
   * @throws when navigation fails; the reference keeps a local retry/close
   *   dialog that replays the same open.
   */
  openFile(path: string): void
  /**
   * Preview a confirmed skill name's source in the right Sidebar.
   * @param name - skill name without its slash.
   */
  openSkill(name: string): void
}

/** The workspace cwd the session's path addressing reads. */
function cwdOf(sessionId: SessionId): string | undefined {
  const cwd = sessionSnapshot()?.[sessionId]?.cwd
  return typeof cwd === 'string' ? cwd : undefined
}

/**
 * The activation actions for one session, or undefined while the host
 * surfaces are absent. Read per call (a render) so faces that materialize
 * later are still found; the composition itself never throws — a throwing
 * face read reads as absent.
 * @param sessionId - the session the paths are read (and previewed) in.
 */
export function referenceActions(sessionId: SessionId | undefined): ReferenceActions | undefined {
  if (sessionId === undefined) return undefined
  try {
    const sidebar = sidebarRightFace()
    if (sidebar === undefined) return undefined
    return {
      openFile(path: string): void {
        sidebar.openResource(fileAddressFor(sessionId, cwdOf(sessionId), path))
      },
      openSkill(name: string): void {
        void (async () => {
          try {
            const catalog = await skillFace()?.catalog(sessionId)
            const path = (catalog as readonly (SkillEntry & { path?: string })[] | undefined)
              ?.find((skill) => skill.name === name)?.path
            if (path === undefined) return
            sidebar.openResource(fileAddressFor(sessionId, cwdOf(sessionId), path))
          } catch (error: unknown) {
            console.error('[markdown-input] skill reference preview failed:', error)
          }
        })()
      },
    }
  } catch {
    return undefined
  }
}
