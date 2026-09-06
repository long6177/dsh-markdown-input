/**
 * Seam 2 tests: the paste converter is a pure function from clipboard
 * `text/html` to clean Markdown. Cases are user-visible behavior: a web
 * paragraph, a Word snippet, a code fragment, and mixed noise must all
 * come out as Markdown the model can read, with no HTML residue.
 */
import { describe, expect, it } from 'vitest'
import { convertHtmlToMarkdown } from '../src/client/paste-converter.ts'

describe('convertHtmlToMarkdown', () => {
  it('converts an empty payload to empty text', () => {
    expect(convertHtmlToMarkdown('')).toBe('')
    expect(convertHtmlToMarkdown('   ')).toBe('')
  })

  it('renders headings as ATX marks', () => {
    expect(convertHtmlToMarkdown('<h1>Title</h1><h2>Sub</h2>')).toBe('# Title\n\n## Sub')
  })

  it('renders unordered and ordered lists', () => {
    expect(convertHtmlToMarkdown('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b')
    expect(convertHtmlToMarkdown('<ol><li>first</li><li>second</li></ol>')).toBe('1. first\n2. second')
  })

  it('keeps bold and italic as markdown emphasis', () => {
    expect(convertHtmlToMarkdown('<p><strong>bold</strong> and <em>it</em></p>')).toBe('**bold** and *it*')
  })

  it('keeps links as markdown links', () => {
    expect(convertHtmlToMarkdown('<p>see <a href="https://example.com">docs</a> here</p>'))
      .toBe('see [docs](https://example.com) here')
  })

  it('keeps inline code', () => {
    expect(convertHtmlToMarkdown('<p>run <code>npm test</code> now</p>')).toBe('run `npm test` now')
  })

  it('converts code fragments to fenced blocks, keeping the language tag and raw content', () => {
    expect(convertHtmlToMarkdown('<pre><code class="language-ts">const a = 1;</code></pre>'))
      .toBe('```ts\nconst a = 1;\n```')
    expect(convertHtmlToMarkdown('<pre><code>plain\nlines</code></pre>'))
      .toBe('```\nplain\nlines\n```')
  })

  it('does not escape markdown characters inside code fragments', () => {
    expect(convertHtmlToMarkdown('<pre><code>a * b && c</code></pre>')).toBe('```\na * b && c\n```')
  })

  it('renders blockquotes', () => {
    expect(convertHtmlToMarkdown('<blockquote><p>quoted</p></blockquote>')).toBe('> quoted')
  })

  it('keeps literal asterisks escaped so they survive as text', () => {
    expect(convertHtmlToMarkdown('<p>5 * 3 * x</p>')).toBe('5 \\* 3 \\* x')
  })

  it('decodes entities into plain text', () => {
    expect(convertHtmlToMarkdown('<p>a &amp; b &lt;tag&gt;</p>')).toBe('a & b <tag>')
  })

  it('strips Word-processor noise: styled spans, wrapper tags, and office markers', () => {
    const word = [
      '<div class="WordSection1">',
      '<p class="MsoNormal"><span style=\'font-family:"Segoe UI"\'>Hello</span></p>',
      '<o:p></o:p>',
      '</div>',
    ].join('')
    expect(convertHtmlToMarkdown(word)).toBe('Hello')
  })

  it('strips script and style payloads entirely', () => {
    expect(convertHtmlToMarkdown('<div><script>alert(1)</script><style>.a{}</style><p>safe</p></div>'))
      .toBe('safe')
  })

  it('drops images while keeping the surrounding text', () => {
    const out = convertHtmlToMarkdown('<p>pic<img src="https://example.com/y.png" alt="y">end</p>')
    expect(out).not.toContain('![')
    expect(out).toContain('pic')
    expect(out).toContain('end')
  })

  it('degrades checkbox lists to plain list items', () => {
    const out = convertHtmlToMarkdown('<ul><li><input type="checkbox">todo</li></ul>')
    expect(out).toBe('- todo')
  })

  it('leaves no HTML residue on nested mixed noise', () => {
    const noisy = [
      '<div class="post">',
      '<!-- comment -->',
      '<div><span>para one</span></div>',
      '<ul><li><b>nested <i>styles</i></b></li></ul>',
      '<p>&nbsp;</p>',
      '</div>',
    ].join('')
    const out = convertHtmlToMarkdown(noisy)
    expect(out).not.toMatch(/<\w+/)
    expect(out).toContain('para one')
    expect(out).toContain('**nested *styles***')
  })

  it('preserves line breaks inside a paragraph', () => {
    const out = convertHtmlToMarkdown('<p>line1<br>line2</p>')
    expect(out).toBe('line1\nline2')
  })
})
