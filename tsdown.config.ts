/**
 * Standalone build for the dsh-markdown-input plugin: the Node half
 * (lib/index.js, ESM) plus the browser half (lib/client.js) as a
 * closure-factory bundle matching the dsh dynamic client-bundle contract —
 * the artifact calls window.__ModuleLoader__.load({id, factory}) and resolves
 * module-table rows (react, cordis, dsh-client-ui-*) through the injected
 * require while everything else (CodeMirror, turndown) inlines.
 */
import { readFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { defineConfig, type UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PLUGIN_ID = 'dsh-markdown-input'

/** Module-table rows this bundle may import as values; everything else inlines. */
const MODULE_TABLE = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** Virtual-id wrapper keeping CSS Modules away from tsdown's own CSS pipeline. */
const CSS_VIRTUAL_PREFIX = '\0plugin-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Emit one plugin-owned style injector and the CSS Modules class map. */
function styleInjectionModule(id: string, fileId: string, css: string, classMap?: Readonly<Record<string, string>>): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${fileId.split(/[\\/]/).pop()}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

const cssModulesPlugin = {
  name: 'plugin-css-modules',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.module.css')) return null
    if (importer === undefined) return null
    return CSS_VIRTUAL_PREFIX + resolvePath(importer.replaceAll('\\', '/'), '../', source) + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId: string) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
    return styleInjectionModule(PLUGIN_ID, fileId, code.toString(), classMap)
  },
} satisfies UserConfig['plugins'] extends (infer P)[] | undefined ? P : never

export default defineConfig([
  {
    // Node half: the loader imports this through a real install, so every
    // bare import stays external. clean stays off — tsc emits lib/types here
    // first and a clean would wipe it.
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    // Browser half: closure-factory CJS per the dynamic bundle contract.
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => (MODULE_TABLE as readonly string[]).includes(specifier),
      alwaysBundle: (specifier: string) => !(MODULE_TABLE as readonly string[]).includes(specifier),
    },
    inputOptions: {
      resolve: {
        conditionNames: ['import', 'module', 'browser', 'default'],
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.MODE': JSON.stringify('production'),
      'import.meta.env': JSON.stringify({ MODE: 'production' }),
    },
    plugins: [cssModulesPlugin],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
