/**
 * Desktop 0.2.0-rc.2 primitives surface additions.
 *
 * The type baseline (devDependencies) still resolves the 0.1.x-era harness
 * declarations, while the shipped desktop kernel renamed the sizing-variant
 * icons (`*Outline16` -> `*OutlineMedium`/`*OutlineRegular`) and replaced
 * `DocumentFileIcon` with the path-driven `FileTypeIcon`. Every symbol below
 * was verified against the rc.2 client bundle's actual export list (extracted
 * from the desktop runtime); the browser half binds these names through the
 * host module table at runtime, so the declarations only close the type gap
 * until the dev baseline is re-pointed at the rc.2 harness sources.
 */
import type { ComponentType } from 'react'

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** rc.2 icon artwork props (`size` defaults to 16 inside the artwork). */
  export interface DshIconProps {
    size?: number
    className?: string
  }
  export const IconCloseOutlineMedium: ComponentType<DshIconProps>
  export const IconPaperclipOutlineMedium: ComponentType<DshIconProps>
  export const IconWarningOutlineMedium: ComponentType<DshIconProps>
  /** rc.2 replacement for DocumentFileIcon: picks the glyph from the file path. */
  export const FileTypeIcon: ComponentType<DshIconProps & { path?: string; kind?: string }>
}
