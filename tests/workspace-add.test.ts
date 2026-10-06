/**
 * The add-flow verb plane (issue #42, alpha.13 retest): the lazy installer
 * over `uiWorkspace.pickDirectory` + `workspaces.create`, and the host
 * `workspace` namespace copy seat. Mirrors the workspace-verb installer's
 * contract: resolution is lazy and capability-detected, a throwing `ctx.get`
 * reads as absent, and a half-reachable flow (one verb without the other)
 * is absent — the face rule for a row that would dead-end halfway.
 */
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_ADD_NS, installWorkspaceAddSource, resetWorkspaceAddLocale, resetWorkspaceAddSource,
  setWorkspaceAddLocale, workspaceAddFace, workspaceAddLocale,
  type WorkspaceAddFace,
} from '../src/client/workspace-add.ts'

function ctxWith(services: Record<string, unknown>): Parameters<typeof installWorkspaceAddSource>[0] {
  return { get: (key: string) => services[key] } as never
}

describe('installWorkspaceAddSource', () => {
  it('exposes the face when both services probe, and wraps create', async () => {
    const pickDirectory = (): Promise<string | null> => Promise.resolve('/picked')
    const create = (_input: { path: string }): Promise<{ workspaceId: string }> =>
      Promise.resolve({ workspaceId: 'w9' })
    installWorkspaceAddSource(ctxWith({
      uiWorkspace: { pickDirectory },
      workspaces: { create },
    }))
    const face: WorkspaceAddFace | undefined = workspaceAddFace()
    expect(typeof face?.pickDirectory).toBe('function')
    expect(await face?.pickDirectory()).toBe('/picked')
    expect(await face?.createWorkspace({ path: '/picked' })).toEqual({ workspaceId: 'w9' })
    // The wrapper delegates to the live services, preserving `this`.
    resetWorkspaceAddSource()
  })

  it('caches the face per service identities (stable across reads)', () => {
    const uiWorkspace = { pickDirectory: () => {} }
    const workspaces = { create: () => {} }
    installWorkspaceAddSource(ctxWith({ uiWorkspace, workspaces }))
    const first = workspaceAddFace()
    expect(workspaceAddFace()).toBe(first)
    // A replaced service identity rebuilds the face.
    installWorkspaceAddSource(ctxWith({ uiWorkspace: { pickDirectory: () => {} }, workspaces }))
    expect(workspaceAddFace()).not.toBe(first)
    resetWorkspaceAddSource()
  })

  it('reads a missing service, a missing verb, or a throwing ctx.get as absent', () => {
    // Either half missing → no face: the add row would dead-end halfway.
    installWorkspaceAddSource(ctxWith({ workspaces: { create: () => {} } }))
    expect(workspaceAddFace()).toBeUndefined()
    installWorkspaceAddSource(ctxWith({ uiWorkspace: { pickDirectory: () => {} } }))
    expect(workspaceAddFace()).toBeUndefined()
    // Neither service at all.
    installWorkspaceAddSource(ctxWith({}))
    expect(workspaceAddFace()).toBeUndefined()
    // Sealed globals / exotic builds: a throwing probe is absence, never a crash.
    installWorkspaceAddSource({ get: () => { throw new Error('sealed') } } as never)
    expect(workspaceAddFace()).toBeUndefined()
    // Uninstalled (the fresh-page shape).
    resetWorkspaceAddSource()
    expect(workspaceAddFace()).toBeUndefined()
  })
})

describe('workspace add-flow copy seat', () => {
  it('binds the host `workspace` namespace and drops it on reset', () => {
    expect(WORKSPACE_ADD_NS).toBe('workspace')
    expect(workspaceAddLocale()).toBeUndefined()
    const t = (key: string): string => key
    setWorkspaceAddLocale(t)
    expect(workspaceAddLocale()).toBe(t)
    resetWorkspaceAddLocale()
    expect(workspaceAddLocale()).toBeUndefined()
  })
})
