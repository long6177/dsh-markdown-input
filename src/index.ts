/**
 * dsh-markdown-input, host half. Pure UI plugin: the host-side apply exists
 * so the plugin appears in the Loader; all user-facing behavior ships in the
 * browser half (exports["./client"]), discovered through the package.json
 * dsh.client declaration. No deployment-varying config exists since the
 * composer takeover retired (ADR-0003) — enhancement layers degrade
 * automatically through capability probes, not configuration.
 * @module dsh-markdown-input
 */

import type { Context } from '@deepseek-ai/cordis'

/** Plugin id used by cordis patch rows to locate this module. */
export const name = 'markdown-input'

/**
 * Host plugin body — no host-side behavior.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  void ctx
}
