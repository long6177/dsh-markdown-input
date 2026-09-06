/** Copy for the markdown-input composer, zh/en. */

export const NS = 'markdown-input'

const zh = {
  'composer.placeholder.render': '以 Markdown 撰写…（Enter 发送，Shift+Enter 换行）',
  'composer.placeholder.source': 'Markdown 源码…（Enter 发送，Shift+Enter 换行）',
  'composer.action.submit': '发送',
  'composer.mode.render': '渲染',
  'composer.mode.source': '源码',
  'composer.mode.toggle': '切换到{mode}模式',
  'composer.attach': '添加附件',
  'composer.dropHere': '松开以添加附件',
  'composer.attachment.remove': '移除附件',
  'composer.file.stillUploading': '仍有文件在上传，请稍候',
  'composer.file.uploading': '上传中…',
  'composer.file.uploadFailed': '上传失败',
  'composer.file.retry': '重试上传',
  'composer.file.rejected': '附件被拒绝',
  'composer.notice.dismiss': '关闭提示',
} as const

export type ComposerKey = keyof typeof zh

const en: Record<ComposerKey, string> = {
  'composer.placeholder.render': 'Write in Markdown… (Enter to send, Shift+Enter for newline)',
  'composer.placeholder.source': 'Markdown source… (Enter to send, Shift+Enter for newline)',
  'composer.action.submit': 'Send',
  'composer.mode.render': 'Render',
  'composer.mode.source': 'Source',
  'composer.mode.toggle': 'Switch to {mode} mode',
  'composer.attach': 'Attach files',
  'composer.dropHere': 'Release to attach',
  'composer.attachment.remove': 'Remove attachment',
  'composer.file.stillUploading': 'A file is still uploading; try again shortly',
  'composer.file.uploading': 'Uploading…',
  'composer.file.uploadFailed': 'Upload failed',
  'composer.file.retry': 'Retry upload',
  'composer.file.rejected': 'Attachment rejected',
  'composer.notice.dismiss': 'Dismiss notice',
}

export { zh, en }
