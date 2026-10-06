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
  ADD_WORKSPACE_ID, addWorkspaceEntry, addWorkspaceIsOnlyEntry, resolveAddWorkspaceCopy,
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
  it('lists every workspace in order, localized, with no add row inside the items', () => {
    const items = workspaceMenuItems([
      view('w1', 'default-workspace'),
      view('w2', 'project'),
    ], DEFAULT_NAME)
    expect(items).toEqual([
      { id: 'w1', label: DEFAULT_NAME },
      { id: 'w2', label: 'project' },
    ])
    // The add action is NOT an item: since the alpha.13 retest it rides the
    // Menu's pinned `footer` (the native picker's `footer={addEntries}`,
    // `WorkspacePicker.tsx:111-119`), so no add entry can ever be mistaken
    // for a pick target here.
    expect(items.some(item => item.label.includes('Add'))).toBe(false)
    expect(items.some(item => item.id === ADD_WORKSPACE_ID)).toBe(false)
  })

  it('is empty for an empty list (no dead pick row)', () => {
    expect(workspaceMenuItems([], DEFAULT_NAME)).toEqual([])
  })
})

describe('addWorkspaceEntry (the native footer row, WorkspacePicker.tsx:106-108)', () => {
  it('carries the native add sentinel, the label, and the busy gate', () => {
    const entry = addWorkspaceEntry('Add workspace…', false)
    expect(entry).toEqual({ id: ADD_WORKSPACE_ID, label: 'Add workspace…', disabled: false })
    expect(ADD_WORKSPACE_ID).toBe('::add-workspace')
    // Native `disabled: flowBusy`: one flow at a time.
    expect(addWorkspaceEntry('添加工作区…', true).disabled).toBe(true)
  })
})

describe('addWorkspaceIsOnlyEntry (the native anchor-gesture edge, WorkspacePicker.tsx:157-162)', () => {
  it('fires only when the flow is reachable, the list settled, and nothing is listed', () => {
    expect(addWorkspaceIsOnlyEntry({ addPresent: true, phase: 'ready', itemCount: 0 })).toBe(true)
  })

  it('stays a menu while rows are listed, the list is pending, or the flow is unreachable', () => {
    expect(addWorkspaceIsOnlyEntry({ addPresent: true, phase: 'ready', itemCount: 2 })).toBe(false)
    expect(addWorkspaceIsOnlyEntry({ addPresent: true, phase: 'pending', itemCount: 0 })).toBe(false)
    expect(addWorkspaceIsOnlyEntry({ addPresent: false, phase: 'ready', itemCount: 0 })).toBe(false)
  })
})

describe('resolveAddWorkspaceCopy (host `workspace` words, plugin fallback under a miss)', () => {
  const own = {
    'menu.addWorkspace': 'Add workspace…',
    'folderError.title': 'Couldn’t open folder',
    'folderError.retry': 'Choose again',
  }

  it('reads the host seat when bound', () => {
    const host = (key: string): string => ({ 'menu.addWorkspace': '添加工作区…' })[key] ?? key
    expect(resolveAddWorkspaceCopy(host, own)['menu.addWorkspace']).toBe('添加工作区…')
  })

  it('falls back per key when the host dictionary misses (the echoed key)', () => {
    const host = ((key: string) => key === 'menu.addWorkspace' ? '添加工作区…' : key) as Parameters<typeof resolveAddWorkspaceCopy>[0]
    const resolved = resolveAddWorkspaceCopy(host, own)
    expect(resolved['menu.addWorkspace']).toBe('添加工作区…')
    expect(resolved['folderError.title']).toBe(own['folderError.title'])
    expect(resolved['folderError.retry']).toBe(own['folderError.retry'])
  })

  it('uses the plugin copy whole when the namespace is unbound', () => {
    expect(resolveAddWorkspaceCopy(undefined, own)).toBe(own)
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
