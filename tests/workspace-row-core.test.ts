/**
 * Pure core of the card-top workspace row (issue #42): the native five-level
 * label chain, the picker rows, the row's visibility rule, and the trigger
 * posture. Every case here mirrors a specific line of the host's own
 * resolution (`ui-conversation/src/client/skeleton/ConversationContent.tsx:99-108`,
 * `:141`) — that chain is a user-visible parity contract, so it is pinned by
 * unit tests rather than by a rendered tree.
 */
import { describe, expect, it } from 'vitest'
import {
  workspaceDisplayTitle, workspaceLabel, workspaceLabelState, workspaceMenuItems,
  workspaceRowSupported, workspaceTitleOf, workspaceTriggerPosture,
  type WorkspaceRowView,
} from '../src/client/workspace-row-core.ts'

const DEFAULT_NAME = 'Default workspace'

function view(workspaceId: string, title: string, sessionIds: readonly string[] = []): WorkspaceRowView {
  return { workspaceId, title, sessionIds }
}

describe('workspaceTitleOf / workspaceLabel (host-parity re-declarations)', () => {
  it('takes the final non-empty segment under either separator', () => {
    expect(workspaceTitleOf('/home/dev/project')).toBe('project')
    expect(workspaceTitleOf('C:\\Users\\dev\\project')).toBe('project')
    expect(workspaceTitleOf('/home/dev/project/')).toBe('project')
    expect(workspaceTitleOf('project')).toBe('project')
  })

  it('answers an empty segment for a separator-only path (so the raw path echoes)', () => {
    expect(workspaceTitleOf('/')).toBe('')
    expect(workspaceTitleOf('\\\\')).toBe('')
    expect(workspaceLabel('/')).toBe('/')
    // A Windows drive root keeps its drive designator, exactly as the host
    // helper does (trailing separators are dropped before the split, so `C:\`
    // has no separator left and reads as its own last segment).
    expect(workspaceLabel('C:\\')).toBe('C:')
    expect(workspaceLabel('\\\\')).toBe('\\\\')
  })

  it('labels a real path by its basename', () => {
    expect(workspaceLabel('/home/dev/my-project')).toBe('my-project')
    expect(workspaceLabel('D:\\work\\dsh-markdown-input')).toBe('dsh-markdown-input')
  })
})

describe('workspaceDisplayTitle (host-parity re-declaration)', () => {
  it('localizes only the automatic first-use title', () => {
    expect(workspaceDisplayTitle('default-workspace', DEFAULT_NAME)).toBe(DEFAULT_NAME)
    expect(workspaceDisplayTitle('my-project', DEFAULT_NAME)).toBe('my-project')
    expect(workspaceDisplayTitle('Default workspace', DEFAULT_NAME)).toBe('Default workspace')
  })
})

describe('workspaceLabelState — the native five-level chain', () => {
  const base = {
    sessionId: 's1' as string | undefined,
    sessionWorkspace: undefined as WorkspaceRowView | undefined,
    pendingWorkspace: undefined as WorkspaceRowView | undefined,
    cwd: undefined as string | undefined,
    phase: 'pending' as 'pending' | 'ready',
    localizedDefaultTitle: DEFAULT_NAME,
  }

  it('level 1: a just-picked workspace wins, even while the list is pending', () => {
    expect(workspaceLabelState({
      ...base,
      pendingWorkspace: view('w2', 'picked'),
      sessionWorkspace: view('w1', 'owner'),
      phase: 'pending',
    })).toBe('picked')
  })

  it('level 2: no session at all is the placeholder (undefined)', () => {
    expect(workspaceLabelState({ ...base, sessionId: undefined, cwd: '/home/dev/project' })).toBeUndefined()
  })

  it('level 3: the blank session\'s owning workspace names the chip', () => {
    expect(workspaceLabelState({
      ...base,
      sessionWorkspace: view('w1', 'owner'),
      cwd: '/home/dev/other',
      phase: 'pending',
    })).toBe('owner')
  })

  it('level 3 reads the automatic first-use title in the reader\'s language', () => {
    expect(workspaceLabelState({
      ...base,
      sessionWorkspace: view('w1', 'default-workspace'),
    })).toBe(DEFAULT_NAME)
  })

  it('level 4: while the list loads, the session cwd basename bridges', () => {
    expect(workspaceLabelState({
      ...base,
      cwd: '/home/dev/project',
      phase: 'pending',
    })).toBe('project')
    expect(workspaceLabelState({
      ...base,
      cwd: 'D:\\work\\project',
      phase: 'pending',
    })).toBe('project')
  })

  it('level 4 keeps the placeholder for an empty or unknown cwd', () => {
    expect(workspaceLabelState({ ...base, cwd: '', phase: 'pending' })).toBeUndefined()
    expect(workspaceLabelState({ ...base, cwd: undefined, phase: 'pending' })).toBeUndefined()
  })

  it('level 5: a ready list with no owning workspace is the placeholder, never cwd', () => {
    expect(workspaceLabelState({
      ...base,
      sessionWorkspace: undefined,
      cwd: '/home/dev/project',
      phase: 'ready',
    })).toBeUndefined()
  })
})

describe('workspaceMenuItems', () => {
  it('lists every workspace in order, localized, with no add row', () => {
    const items = workspaceMenuItems([
      view('w1', 'default-workspace'),
      view('w2', 'project'),
    ], DEFAULT_NAME)
    expect(items).toEqual([
      { id: 'w1', label: DEFAULT_NAME },
      { id: 'w2', label: 'project' },
    ])
    // The native "add workspace" entry is gated on the surface's
    // `conversation.hero.workspace.directoryFlow` hole having an occupant
    // (`WorkspacePicker.tsx:106-108`); no plugin occupies a hole declared by
    // this card, so the row cannot exist here.
    expect(items.some(item => item.label.includes('Add'))).toBe(false)
  })

  it('is empty for an empty list (no dead pick row)', () => {
    expect(workspaceMenuItems([], DEFAULT_NAME)).toEqual([])
  })
})

describe('workspaceRowSupported', () => {
  const support = {
    sessionId: 's1' as string | undefined,
    blank: true,
    hookPresent: true,
    verbPresent: true,
  }

  it('needs a blank session and both data surfaces', () => {
    expect(workspaceRowSupported(support)).toBe(true)
  })

  it('hides the row for an older (non-blank) session', () => {
    expect(workspaceRowSupported({ ...support, blank: false })).toBe(false)
  })

  it('hides the row when the list hook, the verb, or the session is absent', () => {
    expect(workspaceRowSupported({ ...support, hookPresent: false })).toBe(false)
    expect(workspaceRowSupported({ ...support, verbPresent: false })).toBe(false)
    expect(workspaceRowSupported({ ...support, sessionId: undefined })).toBe(false)
  })
})

describe('workspaceTriggerPosture', () => {
  it('turns the card into the picker exactly when a blank session resolved no title', () => {
    expect(workspaceTriggerPosture({ blank: true, label: undefined })).toBe(true)
  })

  it('is off once a title resolves', () => {
    expect(workspaceTriggerPosture({ blank: true, label: 'project' })).toBe(false)
    expect(workspaceTriggerPosture({ blank: true, label: '' })).toBe(false)
  })

  it('is off for a non-blank session whatever the label', () => {
    expect(workspaceTriggerPosture({ blank: false, label: undefined })).toBe(false)
  })
})

describe('workspace verb installer', () => {
  it('probes the host service lazily and reads absent surfaces as absent', async () => {
    const { installWorkspaceVerbSource, resetWorkspaceVerbSource, workspaceVerbFace } =
      await import('../src/client/workspace-verb.ts')
    const startSession = (): void => {}
    installWorkspaceVerbSource({ get: key => key === 'uiWorkspace' ? { startSession } : undefined } as never)
    expect(workspaceVerbFace()?.startSession).toBe(startSession)
    // A namespace without the verb is not usable: probing `startSession` is
    // what keeps a dead pick target off the card.
    installWorkspaceVerbSource({ get: () => ({ someOtherVerb: () => {} }) } as never)
    expect(workspaceVerbFace()).toBeUndefined()
    // A throwing `ctx.get` (sealed globals, exotic builds) reads as absent.
    installWorkspaceVerbSource({ get: () => { throw new Error('sealed') } } as never)
    expect(workspaceVerbFace()).toBeUndefined()
    resetWorkspaceVerbSource()
    expect(workspaceVerbFace()).toBeUndefined()
  })
})
