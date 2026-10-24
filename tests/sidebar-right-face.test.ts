/**
 * Seam: the right-sidebar navigation plane (#75 chip activation). The file-
 * and skill-chip activations open their preview through the host
 * `sidebarRight.openResource(address)` — the same controller the native
 * FileReference and skill source call, whose synchronous throw IS the
 * navigation failure the retry dialogs key on. The face is a thin,
 * capability-detected door (the installer pattern): a host without the
 * service degrades to `undefined` and the chips stay display-only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installSidebarRightSource, resetSidebarRightFace, setSidebarRightSource,
  sidebarRightFace, sidebarRightFaceSupported,
} from '../src/client/sidebar-right-face.ts'

afterEach(() => {
  resetSidebarRightFace()
})

describe('sidebarRightFaceSupported', () => {
  it('fails while no source is bound', () => {
    expect(sidebarRightFaceSupported()).toBe(false)
    expect(sidebarRightFace()).toBeUndefined()
  })

  it('fails when the host lacks the sidebarRight service', () => {
    installSidebarRightSource({ get: () => undefined } as never)
    expect(sidebarRightFaceSupported()).toBe(false)
  })

  it('fails when openResource is not a function', () => {
    installSidebarRightSource({ get: (key: string) => (key === 'sidebarRight' ? {} : undefined) } as never)
    expect(sidebarRightFaceSupported()).toBe(false)
  })

  it('passes when the service exposes openResource', () => {
    installSidebarRightSource({
      get: (key: string) => (key === 'sidebarRight' ? { openResource: vi.fn() } : undefined),
    } as never)
    expect(sidebarRightFaceSupported()).toBe(true)
    expect(sidebarRightFace()).not.toBeUndefined()
  })

  it('survives a throwing service read', () => {
    installSidebarRightSource({ get: () => { throw new Error('sealed') } } as never)
    expect(sidebarRightFaceSupported()).toBe(false)
  })
})

describe('sidebarRightFace.openResource', () => {
  it('forwards the address to the host controller', () => {
    const openResource = vi.fn()
    setSidebarRightSource(() => ({ sidebarRight: { openResource } }))
    sidebarRightFace()?.openResource('dsh-resource://file/session/s1/a.md')
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/a.md')
  })

  it('rethrows the host navigation failure (the retry dialogs key on it)', () => {
    const openResource = vi.fn(() => { throw new Error('no type accepts the address') })
    setSidebarRightSource(() => ({ sidebarRight: { openResource } }))
    expect(() => sidebarRightFace()?.openResource('dsh-resource://file/x')).toThrow('no type accepts the address')
  })
})
