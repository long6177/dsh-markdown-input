/**
 * Seam: the reference-chip activation plane (#75) — the `references` object
 * the sent-text projection hands to its activatable chips. `openFile` is
 * the native FileReference contract verbatim: a synchronous,
 * session-scoped sidebar navigation whose throw IS the failure (the retry
 * dialog replays it). `openSkill` mirrors the native skill source: the
 * catalog is consulted for the entry's `SKILL.md` path, a pathless entry
 * (or a failed catalog read) opens nothing, and a navigation failure is
 * logged, not thrown through the click handler. The object composes the
 * capability-detected faces (sidebar-right, sessions snapshot, skill
 * catalog) per call — a host without the sidebar-right plane degrades it to
 * `undefined`, and every chip stays a display-only span.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { referenceActions } from '../src/client/reference-actions-face.ts'
import { resetSessionsSource, setSessionsSource } from '../src/client/sessions-face.ts'
import { resetSidebarRightFace, setSidebarRightSource } from '../src/client/sidebar-right-face.ts'
import { resetSkillFace, setSkillSource, skillFace } from '../src/client/skill-face.ts'

afterEach(() => {
  resetSidebarRightFace()
  resetSkillFace()
  resetSessionsSource()
})

function bindHost(options: {
  openResource?: ReturnType<typeof vi.fn>
  byId?: Record<string, unknown>
  skills?: readonly { name: string, path?: string }[]
} = {}) {
  const openResource = options.openResource ?? vi.fn()
  setSidebarRightSource(() => ({ sidebarRight: { openResource } }))
  setSessionsSource(() => ({
    get: (key: string) => (key === 'sessions'
      ? { list: { getSnapshot: () => ({ byId: options.byId ?? {} }) } }
      : undefined),
  }))
  if (options.skills !== undefined) {
    setSkillSource(() => ({
      skills: { list: vi.fn(() => Promise.resolve({ ok: true, value: { skills: options.skills! } })) },
      remoteEvents: undefined,
    }))
  }
  return { openResource }
}

describe('referenceActions', () => {
  it('is undefined while no source is installed', () => {
    expect(referenceActions('s1')).toBeUndefined()
  })

  it('is undefined without a session to address paths in', () => {
    bindHost()
    expect(referenceActions(undefined)).toBeUndefined()
  })
})

describe('referenceActions.openFile', () => {
  it('addresses a relative path under the session scope', () => {
    const { openResource } = bindHost({ byId: { s1: { cwd: '/w' } } })
    referenceActions('s1')?.openFile('notes/a.md')
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/notes/a.md')
  })

  it('rethrows the navigation failure (the retry dialog keys on the sync throw)', () => {
    const { openResource } = bindHost({ byId: { s1: { cwd: '/w' } } })
    openResource.mockImplementationOnce(() => { throw new Error('boom') })
    expect(() => referenceActions('s1')?.openFile('notes/a.md')).toThrow('boom')
  })

  it('strips the workspace root from an absolute path inside the workspace', () => {
    const { openResource } = bindHost({ byId: { s1: { cwd: '/w' } } })
    referenceActions('s1')?.openFile('/w/notes/a.md')
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/notes/a.md')
  })

  it('keeps an absolute path outside the workspace absolute in the session address', () => {
    const { openResource } = bindHost({ byId: { s1: { cwd: '/w' } } })
    referenceActions('s1')?.openFile('/else/where/a.md')
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1//else/where/a.md')
  })

  it('addresses without a recorded cwd (session scope decides the root)', () => {
    const { openResource } = bindHost()
    referenceActions('s1')?.openFile('notes/a.md')
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/notes/a.md')
  })
})

describe('referenceActions.openSkill', () => {
  it('opens the catalog entry path, session-scoped', async () => {
    const { openResource } = bindHost({
      byId: { s1: { cwd: '/w' } },
      skills: [{ name: 'plan', path: '/w/skills/plan/SKILL.md' }],
    })
    referenceActions('s1')?.openSkill('plan')
    await vi.waitFor(() => expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/skills/plan/SKILL.md'))
  })

  it('does nothing for a pathless catalog entry', async () => {
    const { openResource } = bindHost({ skills: [{ name: 'plan' }] })
    referenceActions('s1')?.openSkill('plan')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(openResource).not.toHaveBeenCalled()
  })

  it('does nothing when the catalog read fails', async () => {
    const openResource = vi.fn()
    setSidebarRightSource(() => ({ sidebarRight: { openResource } }))
    setSessionsSource(() => ({ get: () => undefined }))
    setSkillSource(() => ({
      skills: { list: vi.fn(() => Promise.reject(new Error('offline'))) },
      remoteEvents: undefined,
    }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      referenceActions('s1')?.openSkill('plan')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(openResource).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('logs a navigation failure instead of throwing through the click', async () => {
    const openResource = vi.fn(() => { throw new Error('boom') })
    bindHost({ openResource, skills: [{ name: 'plan', path: '/p/SKILL.md' }] })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => referenceActions('s1')?.openSkill('plan')).not.toThrow()
      await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())
    } finally {
      consoleError.mockRestore()
    }
  })

  it('resolves the path from the cached lexicon without a refetch', async () => {
    const { openResource } = bindHost({
      byId: { s1: { cwd: '/w' } },
      skills: [{ name: 'plan', path: '/w/skills/plan/SKILL.md' }],
    })
    skillFace()!.ensure('s1')
    await vi.waitFor(() => expect(skillFace()!.lexicons.getSnapshot().value.has('s1')).toBe(true))
    referenceActions('s1')?.openSkill('plan')
    await vi.waitFor(() => expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/skills/plan/SKILL.md'))
  })
})
