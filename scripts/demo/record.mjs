// record.mjs — drive `dsh web` with headless Edge (Playwright) and capture the
// frames behind the README demo assets: one hero GIF storyboard (type Markdown
// in the takeover composer → live render → send → rendered user bubble) plus
// the static shots (render-vs-source, paste-conversion, bubble-markdown).
//
// Everything captured here is synthetic: neutral workspace, scripted demo
// text, a fresh throwaway browser profile. No real user content is involved.
//
// Usage:
//   node record.mjs <tokenized-url> [--out <dir>]
//
//   <tokenized-url>  the full URL the dsh server prints on boot, token
//                    included (the app 401s a bare localhost without it).
//   --out <dir>      output directory (default:
//                    %TEMP%/dsh-markdown-input-demo/run-<timestamp>). The
//                    frames are intermediate scratch — encode.mjs turns them
//                    into the committed docs/assets/ artifacts.
//
// Requirements:
//   - a running dsh web profile with this plugin (see README.md "Re-recording")
//   - Edge on PATH-discovered location (Playwright `channel: 'msedge'`); no
//     browser download happens, and no global install is needed.
//
// Steps of one run (also the order you will see in the browser):
//   1. open the app, dismiss the preview notice if it is showing
//   2. statics: type the demo message, shoot render mode vs source mode
//   3. statics: clear, paste rich HTML in source mode, shoot the converted
//      Markdown
//   4. hero: clear, retype the demo message in stages (one PNG per stage),
//      press Enter, and capture the rendered user bubble — recording stops
//      before the keyless server's failed model round can paint anything
//   5. write manifest.json describing the storyboard (frame → GIF duration)
//
// Typing cooperates with the editor's Shift+Enter contract (render mode):
//   - Shift+Enter on a non-empty list row continues the list: the next line
//     already carries a fresh "- ", so list content is typed WITHOUT a marker
//   - Shift+Enter on an empty marker row exits the list (the row becomes the
//     blank paragraph separator), which is how the gap before the code fence
//     is made
//   - inside a fenced block Shift+Enter is a plain newline

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

// ---------------------------------------------------------------------------
// Scripted demo content (all synthetic, English, no private references).
// ---------------------------------------------------------------------------

// The demo message as it ends up in the document (source form; the assert in
// the source-mode shot pins this). The blank-line counts are the editor's own
// newline behavior for this keystroke sequence — render mode collapses them to
// normal paragraph gaps. The first line is deliberately plain prose: dsh
// derives the session title from it, and the title never appears in a cropped
// frame, but it stays neutral even if a future crop changes.
const DEMO_MESSAGE = [
  'Sprint 42 notes',
  '',
  '',
  '## What shipped',
  '- **Live rendering** while you type',
  '- Paste rich text, get clean Markdown',
  '',
  '',
  '```ts',
  'const greet = (name: string) => `hi, ${name}`',
  '```',
].join('\n')

// Rich-text payload for the paste-conversion static (what a webpage copy
// gives the clipboard), rendered on a blank page for the "before" shot.
const PASTE_HTML = [
  '<h2>Sprint 42 notes</h2>',
  '<p>Shipped this week: <b>live rendering</b>, <i>paste conversion</i> and <code>inline code</code>.</p>',
  '<ul>',
  '  <li><b>Bold</b>, <i>italic</i> and <code>code</code> survive</li>',
  '  <li><a href="https://example.com/docs">Links</a> stay clickable</li>',
  '</ul>',
  '<blockquote><p>Blockquotes convert too.</p></blockquote>',
].join('\n')

// Fixed page crop (CSS px) for the hero storyboard at a 1000x700 viewport:
// the conversation column below the header (header, tabs, session title and
// workspace picker all stay out of frame).
const HERO_CLIP = { x: 160, y: 74, width: 720, height: 626 }

// Storyboard timing (ms per GIF frame), mirrors the capture stages below.
const HERO_DURATIONS = [1400, 900, 900, 1000, 900, 1000, 1800, 3000]

// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const url = args[0]
if (!url || !url.startsWith('http')) {
  console.error('usage: node record.mjs <tokenized-url> [--out <dir>]')
  process.exit(1)
}
const outArg = args.indexOf('--out')
const outDir = outArg > -1 ? args[outArg + 1] : join(tmpdir(), 'dsh-markdown-input-demo', `run-${Date.now()}`)
const heroDir = join(outDir, 'hero')
const staticDir = join(outDir, 'static')
for (const dir of [outDir, heroDir, staticDir]) mkdirSync(dir, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 700 },
    deviceScaleFactor: 2, // PNGs land at 2x as required for docs/assets
    locale: 'en-US',
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin })
  const page = await context.newPage()
  page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 200)))

  console.log('open', url)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('[data-markdown-composer]', { timeout: 20000 })

  // First-run preview notice: dismiss it so no frame can contain it. The ack
  // persists server-side, so this is a no-op on later runs.
  const cont = page.getByRole('button', { name: 'Continue' })
  if (await cont.count()) {
    await cont.click()
    await cont.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    console.log('preview notice dismissed')
  }

  const card = page.locator('[data-markdown-composer]').first()
  await card.waitFor({ state: 'visible', timeout: 10000 })
  const surface = page.locator('[data-markdown-surface] .cm-content').first()
  const shotCard = (name) => card.screenshot({ path: join(staticDir, `${name}.png`) })
  const shotHero = (name) => page.screenshot({ path: join(heroDir, `${name}.png`), clip: HERO_CLIP })

  // --- editor primitives ----------------------------------------------------

  // The document text as lines (what CodeMirror shows; folded widgets keep
  // their raw source here, so this is a true content check). The empty-state
  // placeholder renders inside .cm-content, so it is filtered out; trailing
  // blank lines are dropped on both sides to make the compare stable.
  const docLines = async () =>
    (await surface.innerText())
      .split('\n')
      .map((line) => line.replace(/\u00a0/g, ' '))
      .filter((line) => !line.includes('Write in Markdown') && !line.includes('Markdown source'))
  const trimDoc = (lines) => {
    const copy = [...lines]
    while (copy.length && copy[copy.length - 1].trim() === '') copy.pop()
    return copy.join('\n')
  }

  async function expectDoc(expected) {
    const actual = trimDoc(await docLines())
    if (actual !== trimDoc(expected.split('\n'))) {
      throw new Error(`editor content mismatch:\n--- expected ---\n${expected}\n--- actual ---\n${actual}`)
    }
  }

  const typeText = async (text) => {
    if (text) await page.keyboard.type(text, { delay: 15 })
  }
  const nextLine = async () => {
    await page.keyboard.down('Shift')
    await page.keyboard.press('Enter')
    await page.keyboard.up('Shift')
  }

  // Type the shared demo message. Typing follows the editor's own list
  // behavior: after a list row, Shift+Enter has already inserted "- ", so the
  // content is typed without a marker; leaving the list is Shift+Enter twice.
  async function typeDemoMessage({ onStage } = {}) {
    await surface.click()
    await typeText('Sprint 42 notes')
    if (onStage) await onStage('01-title')

    await nextLine() // plain newline after prose
    await nextLine() // the blank paragraph line
    await typeText('## What shipped')
    if (onStage) await onStage('02-heading')

    await nextLine()
    await typeText('- **Live rendering** while you type')
    await sleep(300) // let the heading above fold its marker
    if (onStage) await onStage('03-fold')

    await nextLine() // list continuation: "- " is already on the line
    await typeText('Paste rich text, get clean Markdown')
    if (onStage) await onStage('04-list')

    await nextLine() // continues the list with an empty "- " row
    await nextLine() // exits the list: the empty row becomes the blank line
    await typeText('```ts')
    await nextLine() // inside the fence: plain newline
    await typeText('const greet = (name: string) => `hi, ${name}`')
    await nextLine() // inside the fence: plain newline
    await typeText('```')
    if (onStage) await onStage('05-code')

    await nextLine() // plain newline after the fence; caret on a blank line
    if (onStage) await onStage('06-rendered')
  }

  async function clearComposer() {
    await surface.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await sleep(500) // draft mirror debounce
    await expectDoc('')
  }

  async function toggleMode(target) {
    await card.getByRole('button', { name: new RegExp(`Switch to ${target} mode`, 'i') }).click()
    await sleep(350)
  }

  // --- 1. statics: render mode vs source mode ------------------------------
  await typeDemoMessage()
  await toggleMode('Source')
  await expectDoc(DEMO_MESSAGE) // raw-source assert only holds in source mode
  await shotCard('render-vs-source-source')
  console.log('static: render-vs-source-source')

  await toggleMode('Render')
  await shotCard('render-vs-source-render')
  console.log('static: render-vs-source-render')

  // --- 2. statics: paste conversion (shown in source mode) ------------------
  await clearComposer()
  await toggleMode('Source')

  // "Before" shot: the same rich text as a tiny webpage.
  const richPage = await context.newPage()
  await richPage.setViewportSize({ width: 693, height: 420 })
  await richPage.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="font-family: Segoe UI, sans-serif; padding: 24px 28px; color: #1f2328;">${PASTE_HTML}</body></html>`)}`)
  await richPage.locator('body').screenshot({ path: join(staticDir, 'paste-conversion-rich.png') })
  await richPage.close()

  // Paste into the takeover editor; the text/html payload becomes Markdown,
  // shown here raw (source mode) so the converted form is readable.
  await page.evaluate(async (html) => {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })])
  }, PASTE_HTML)
  await surface.click()
  await page.keyboard.press('Control+v')
  await sleep(700)
  const pasted = (await docLines()).join('\n')
  if (!pasted.includes('## Sprint 42 notes') || !pasted.includes('[Links](https://example.com/docs) stay clickable')) {
    throw new Error(`paste conversion did not produce the expected Markdown:\n${pasted}`)
  }
  await shotCard('paste-conversion-markdown')
  console.log('static: paste-conversion (rich + markdown)')

  // Reset: render mode, empty composer.
  await toggleMode('Render')
  await clearComposer()

  // --- 3. hero storyboard ---------------------------------------------------
  await shotHero('00-empty')
  console.log('hero: 00-empty')

  await typeDemoMessage({
    onStage: async (name) => {
      await shotHero(name)
      console.log(`hero: ${name}`)
    },
  })

  // Send and catch the rendered user bubble the moment it appears — well
  // before the keyless server's failed model round could paint anything.
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-markdown-user-message]', { timeout: 5000 })
  await sleep(150) // one paint for the bubble
  await shotHero('07-sent')
  const bubble = page.locator('[data-markdown-user-bubble]').first()
  await bubble.screenshot({ path: join(staticDir, 'bubble-markdown.png') })
  console.log('hero: 07-sent + static: bubble-markdown')

  // --- manifest -------------------------------------------------------------
  const heroFrames = ['00-empty', '01-title', '02-heading', '03-fold', '04-list', '05-code', '06-rendered', '07-sent']
  if (HERO_DURATIONS.length !== heroFrames.length) throw new Error('HERO_DURATIONS must match hero frame count')
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        url: new URL(url).origin,
        viewport: { width: 1000, height: 700, deviceScaleFactor: 2 },
        heroClip: HERO_CLIP,
        hero: heroFrames.map((name, i) => ({ file: `hero/${name}.png`, durationMs: HERO_DURATIONS[i] })),
        statics: [
          'static/render-vs-source-render.png',
          'static/render-vs-source-source.png',
          'static/paste-conversion-rich.png',
          'static/paste-conversion-markdown.png',
          'static/bubble-markdown.png',
        ],
      },
      null,
      2,
    ),
  )
  console.log(`manifest written to ${join(outDir, 'manifest.json')}`)
  console.log(`done — frames in ${outDir}`)
  await context.close()
} finally {
  await browser.close()
}
