/**
 * dsh-markdown-input, host half. Pure UI plugin: the host-side apply exists so
 * the plugin appears in the Loader and owns validated Config; all user-facing
 * behavior ships in the browser half (exports["./client"]), discovered through
 * the package.json dsh.client declaration.
 * @module dsh-markdown-input
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

/** Plugin id used by cordis patch rows to locate this module. */
export const name = 'markdown-input'

/**
 * Plugin config. Deployment-varying choices live here, never as constants
 * (fail-loud validated by the schema at load).
 */
export interface Config {
  /**
   * Editing mode the taken-over composer opens in (default `render`). The
   * in-composer toggle overrides this per use and persists the choice in the
   * browser.
   */
  defaultMode?: 'render' | 'source'
}

export const Config: Schema<Config> = Schema.object({
  defaultMode: Schema.union(['render', 'source']).default('render'),
})

/**
 * Host plugin body — no host-side behavior; the config exists so deployments
 * can declare `defaultMode` in cordis.yml and the schema validates it.
 * KNOWN GAP: there is no established channel that carries a plugin's host
 * config into its browser half yet, so the client half currently honors the
 * user's persisted browser choice (localStorage) with 'render' as fallback.
 * Wiring host → browser config is tracked as follow-up work.
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  void ctx
  void config
}
