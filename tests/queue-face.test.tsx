/**
 * Seam: the queue strip's row previews as the user sees them (#75). The
 * preview rides the sent-text projection, so its chips fold in — and with
 * the activation planes bound they are the same clickable chips the durable
 * bubbles render: a file chip opens the session-scoped sidebar preview, a
 * loaded `/skill` chip previews the entry's source (beyond the native dock,
 * whose previews are display-only), and without the planes everything stays
 * a display-only span.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { QueueFace, type QueueFaceProps } from '../src/client/QueueFace.tsx'
import type { QueueViewRow } from '../src/client/queue-core.ts'
import { resetSessionsSource, setSessionsSource } from '../src/client/sessions-face.ts'
import { resetSidebarRightFace, setSidebarRightSource } from '../src/client/sidebar-right-face.ts'
import { resetSkillFace, setSkillSource } from '../src/client/skill-face.ts'
import { NS, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  resetSidebarRightFace()
  resetSkillFace()
  resetSessionsSource()
})

const t = ((key: string, params?: Record<string, unknown>) => {
  const template = (zh as Record<string, string>)[key] ?? key
  return template.replaceAll(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? `{${name}}`))
}) as QueueFaceProps['t']

function mountQueue(rows: readonly QueueViewRow[], options: { sessionId?: string } = {}): { openResource: ReturnType<typeof vi.fn> } {
  const openResource = vi.fn()
  setSidebarRightSource(() => ({ sidebarRight: { openResource } }))
  setSessionsSource(() => ({
    get: (key: string) => (key === 'sessions'
      ? { list: { getSnapshot: () => ({ byId: { s1: { cwd: '/w' } } }) } }
      : undefined),
  }))
  render(
    <QueueFace
      rows={rows}
      mutable={false}
      running={false}
      updateQueue={undefined}
      loadImage={undefined}
      t={t}
      onError={vi.fn()}
      sessionId={options.sessionId}
    />,
  )
  return { openResource }
}

describe('QueueFace preview chips (#75)', () => {
  it('renders a queued @path as a clickable chip that opens the session-scoped preview', () => {
    const { openResource } = mountQueue(
      [{ kind: 'queued', id: 'q1', content: [{ type: 'text', text: '@notes/a.md 看看' }] }],
      { sessionId: 's1' },
    )
    const chip = document.querySelector('button[data-ref-chip="file"]')
    expect(chip).not.toBeNull()
    fireEvent.click(chip!)
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/notes/a.md')
  })

  it('renders a loaded skill as a clickable chip that previews the source', async () => {
    setSkillSource(() => ({
      skills: {
        list: vi.fn(() => Promise.resolve({
          ok: true,
          value: { skills: [{ name: 'plan', path: '/w/skills/plan/SKILL.md' }] },
        })),
      },
      remoteEvents: undefined,
    }))
    const { openResource } = mountQueue(
      [{ kind: 'queued', id: 'q1', content: [{ type: 'text', text: '/plan 列一下' }] }],
      { sessionId: 's1' },
    )
    await waitFor(() => expect(document.querySelector('button[data-ref-chip="skill"]')).not.toBeNull())
    fireEvent.click(document.querySelector('button[data-ref-chip="skill"]')!)
    await waitFor(() => expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/skills/plan/SKILL.md'))
  })

  it('keeps the preview spans when no session identity is available', () => {
    mountQueue(
      [{ kind: 'queued', id: 'q1', content: [{ type: 'text', text: '@notes/a.md 看看' }] }],
    )
    expect(document.querySelector('button[data-ref-chip]')).toBeNull()
    expect(document.querySelector('[data-ref-chip="file"]')).not.toBeNull()
  })
})
