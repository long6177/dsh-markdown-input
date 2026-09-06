/** Copy for the markdown-input composer, zh/en. */

export const NS = 'markdown-input'

const zh = {
  'composer.placeholder.render': '以 Markdown 撰写…（Enter 发送，Shift+Enter 换行）',
  'composer.placeholder.source': 'Markdown 源码…（Enter 发送，Shift+Enter 换行）',
  'composer.action.submit': '发送',
  'composer.mode.render': '渲染',
  'composer.mode.source': '源码',
  'composer.mode.toggle': '切换到{mode}模式',
} as const

export type ComposerKey = keyof typeof zh

const en: Record<ComposerKey, string> = {
  'composer.placeholder.render': 'Write in Markdown… (Enter to send, Shift+Enter for newline)',
  'composer.placeholder.source': 'Markdown source… (Enter to send, Shift+Enter for newline)',
  'composer.action.submit': 'Send',
  'composer.mode.render': 'Render',
  'composer.mode.source': 'Source',
  'composer.mode.toggle': 'Switch to {mode} mode',
}

export { zh, en }
