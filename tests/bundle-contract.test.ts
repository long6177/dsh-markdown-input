/**
 * Seam 0: artifact contract smoke checks over the built browser half and the
 * packaging manifests. Skipped when the bundle has not been built yet, so a
 * bare `pnpm test` in a fresh clone still passes.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const bundlePath = resolve(root, 'lib/client.js')
const patchPath = resolve(root, 'cordis.patch.yml')
const packageJson: {
  name: string
  exports: Record<string, unknown>
  files: string[]
  dsh: { client: { platform: string, inject: string[] } }
} = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

describe.skipIf(!existsSync(bundlePath))('built browser half', () => {
  const bundle = readFileSync(bundlePath, 'utf8')

  it('wraps the bundle in the dsh closure-factory contract', () => {
    expect(bundle.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(bundle).toContain('id: "dsh-markdown-input"')
    expect(bundle).toContain('factory: (require) => {')
    const code = bundle.replace(/\/\/# sourceMappingURL=.*$/u, '').trimEnd()
    expect(code).toMatch(/return module\.exports;\s*\}\s*\}\);\s*$/u)
  })

/** Module-table rows the bundle may require through the injected require. */
const MODULE_TABLE = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])

  it('resolves every external through the module table and inlines the rest', () => {
    const externals = [...bundle.matchAll(/require\("((?:[^"\\]|\\.)+)"\)/gu)]
      .map(match => match[1]!)
      .filter(specifier => !specifier.startsWith('./') && !specifier.startsWith('../'))
    expect(externals.length).toBeGreaterThan(0)
    expect([...new Set(externals)]).toEqual([...new Set(externals)].filter(s => MODULE_TABLE.has(s)))
    // turndown (and everything else non-baseline) is a private copy.
    expect(externals).not.toContain('turndown')
  })

  it('registers both the composer takeover and the user-message renderer', () => {
    expect(bundle).toContain('"conversation.composer"')
    expect(bundle).toContain('"conversation.chat.node"')
    expect(bundle).toContain('priority: 2')
  })
})

describe('packaging manifests', () => {
  it('declares the client export and web platform', () => {
    expect(packageJson.exports).toHaveProperty('./client')
    expect(packageJson.dsh.client.platform).toBe('web')
    expect(packageJson.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-conversation')
    expect(packageJson.files).toEqual(expect.arrayContaining(['lib', 'cordis.patch.yml']))
    if (existsSync(bundlePath)) {
      const clientExport = packageJson.exports['./client'] as { types: string, default: string }
      expect(clientExport.default).toMatch(/lib\/client\.js/u)
      expect(clientExport.types).toMatch(/lib\/types\/client\/index\.d\.ts/u)
    }
  })

  it('ships a cordis patch row whose id matches the plugin name', () => {
    expect(existsSync(patchPath)).toBe(true)
    const patch = readFileSync(patchPath, 'utf8')
    expect(patch).toContain('insert:')
    expect(patch).toContain('id: markdown-input')
    expect(patch).toContain(`name: ${packageJson.name}`)
  })
})
