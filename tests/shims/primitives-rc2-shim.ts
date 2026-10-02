/**
 * Test shim: rc.2 primitives names over the 0.1.x-era sibling runtime.
 *
 * The unit/component tests execute against the devDependencies checkout
 * (harness master era), whose primitives still ship the `*Outline16` icon
 * names and `DocumentFileIcon`. The production browser half binds the rc.2
 * names through the host module table (verified against the shipped rc.2
 * client bundle). This shim re-exports the real sibling primitives and maps
 * the renamed rc.2 symbols onto their 0.1.x equivalents so the components
 * render in tests without forking the production source.
 */
import * as base from '../../../deepseek-harness/packages/client/ui-primitives/lib/index.js'

const typed = base as unknown as Record<string, unknown>

export const IconCloseOutlineMedium = typed.IconCloseOutline16
export const IconPaperclipOutlineMedium = typed.IconPaperclipOutline16
export const IconWarningOutlineMedium = typed.IconWarningOutline16
export const FileTypeIcon = typed.DocumentFileIcon

export * from '../../../deepseek-harness/packages/client/ui-primitives/lib/index.js'
