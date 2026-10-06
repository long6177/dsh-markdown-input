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
  // Read on demand: vitest runs a describe body during collection even when
  // the suite is skipped, so an eager read here would crash a lib-less tree
  // — the fresh-clone pass this file promises (header note) must hold.
  const bundle = () => readFileSync(bundlePath, 'utf8')

  it('wraps the bundle in the dsh closure-factory contract', () => {
    expect(bundle().startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(bundle()).toContain('id: "dsh-markdown-input"')
    expect(bundle()).toContain('factory: (require) => {')
    const code = bundle().replace(/\/\/# sourceMappingURL=.*$/u, '').trimEnd()
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
    const externals = [...bundle().matchAll(/require\("((?:[^"\\]|\\.)+)"\)/gu)]
      .map(match => match[1]!)
      .filter(specifier => !specifier.startsWith('./') && !specifier.startsWith('../'))
    expect(externals.length).toBeGreaterThan(0)
    expect([...new Set(externals)]).toEqual([...new Set(externals)].filter(s => MODULE_TABLE.has(s)))
    // turndown (and everything else non-baseline) is a private copy.
    expect(externals).not.toContain('turndown')
  })

  it('takes over the composer and registers the user-message renderer', () => {
    expect(bundle()).toContain('"conversation.composer"')
    expect(bundle()).toContain('"conversation.chat.node"')
  })
})

describe('packaging manifests', () => {
  it('declares the client export and web platform', () => {
    expect(packageJson.exports).toHaveProperty('./client')
    expect(packageJson.dsh.client.platform).toBe('web')
    // ui-chat must load before this row materializes: the chat view owns the
    // 'conversation.chat.node' children declaration our seat registers into,
    // and the registry throws when the slot is not yet declared. The
    // takeover card reads the conversation service (attachments, notices)
    // and registers dictionaries, so locale and ui-conversation load first.
    expect(packageJson.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-chat')
    expect(packageJson.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-slots')
    expect(packageJson.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-conversation')
    expect(packageJson.dsh.client.inject).toContain('@deepseek-ai/dsh-client-locale')
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
