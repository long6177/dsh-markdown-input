/**
 * Clipboard `text/html` → clean Markdown conversion for the composer paste
 * handler. One generic converter (turndown); no source-specific tuning.
 * Images are dropped (the v1 render set is text structure only), while
 * scripts and styles are stripped so their payloads never leak as noise.
 */
import TurndownService from 'turndown'

const converter = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
})

converter.addRule('dropImages', { filter: 'img', replacement: () => '' })
converter.remove(['script', 'style'])

// Turndown's default code block is a 4-space indent; chat markdown renders
// fenced blocks, so emit fences and keep the language tag when the source
// carried one. Raw textContent, because the pipeline escapes prose only.
converter.addRule('fencedCodeBlock', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const first = node.firstChild
    const className = first !== null && first.nodeName === 'CODE'
      ? (first as Element).getAttribute('class') ?? ''
      : ''
    const lang = /(?:^|\s)language-(\S+)/u.exec(className)?.[1] ?? ''
    return `\n\n\`\`\`${lang}\n${node.textContent ?? ''}\n\`\`\`\n\n`
  },
})

// The default hard break pads `  \n` for strict CommonMark; in a chat
// composer the plain newline is the intent and the padding is noise.
converter.addRule('softBreak', { filter: 'br', replacement: () => '\n' })

/** Compact turndown's aligned list padding and redundant blank lines. */
function tidy(markdown: string): string {
  return markdown
    .replaceAll(/^(\s*)- {3,}/gmu, '$1- ')
    .replaceAll(/^(\s*)(\d+)\. {2,}/gmu, '$1$2. ')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim()
}

/**
 * Convert one clipboard `text/html` payload to clean Markdown.
 * @param html - the raw HTML flavor (may be empty when the source is plain).
 * @returns trimmed Markdown source; empty input maps to empty output.
 */
export function convertHtmlToMarkdown(html: string): string {
  if (html.trim() === '') return ''
  return tidy(converter.turndown(html))
}
