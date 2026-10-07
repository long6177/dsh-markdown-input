// encode.mjs — turn a record.mjs run directory into the committed demo assets
// under docs/assets/, using only this directory's JS dependencies (pngjs for
// pixel work, gifenc for the GIF — no ffmpeg, no Python).
//
// Usage:
//   node encode.mjs <run-dir>
//
//   <run-dir>  a record.mjs output directory (contains manifest.json).
//
// Produces (into ../../docs/assets relative to this script):
//   hero-markdown-composer.gif  — the hero GIF storyboard (loop 0, per-frame
//                                 durations from the manifest, downscaled 2x
//                                 to 1x so the committed GIF is viewport-sized)
//   render-vs-source.png        — render/source card shots stacked vertically
//   paste-conversion.png        — rich-text "before" over converted Markdown
//   bubble-markdown.png         — the rendered user bubble (copied through)
//
// Also writes <run-dir>/qa-sheet.png (all hero frames in one strip) for the
// mandatory eyeball check, and prints spec assertions (width, duration, size).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import gifenc from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = gifenc

const scriptDir = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(scriptDir, '..', '..', 'docs', 'assets')

const runDir = process.argv[2]
if (!runDir) {
  console.error('usage: node encode.mjs <run-dir>')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8'))

// --- pixel helpers -----------------------------------------------------------

function loadPng(path) {
  return PNG.sync.read(readFileSync(path))
}

/** Average each 2x2 source block into one output pixel (2x DPR downscale). */
function downscale2x(png) {
  if (png.width % 2 !== 0 || png.height % 2 !== 0) throw new Error(`odd dimensions: ${png.width}x${png.height}`)
  const out = new PNG({ width: png.width / 2, height: png.height / 2 })
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      for (let c = 0; c < 4; c++) {
        const i00 = (2 * y * png.width + 2 * x) * 4 + c
        const i10 = i00 + 4
        const i01 = i00 + png.width * 4
        const i11 = i01 + 4
        out.data[(y * out.width + x) * 4 + c] = (png.data[i00] + png.data[i10] + png.data[i01] + png.data[i11]) >> 2
      }
    }
  }
  return out
}

/** Drop fully-white bottom rows (keeping `padding` rows of breathing room). */
function trimBottom(png, padding = 28) {
  const isWhiteRow = (y) => {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4
      if (png.data[i] < 250 || png.data[i + 1] < 250 || png.data[i + 2] < 250) return false
    }
    return true
  }
  let end = png.height
  while (end > padding && isWhiteRow(end - 1)) end--
  const out = new PNG({ width: png.width, height: Math.min(png.height, end + padding) })
  PNG.bitblt(png, out, 0, 0, out.width, out.height, 0, 0)
  return out
}

/** Stack PNGs vertically on a white background, padded to the widest input. */
function stackVertical(pngs, gap = 24, background = 0xffffffff) {
  const width = Math.max(...pngs.map((p) => p.width))
  const height = pngs.reduce((sum, p) => sum + p.height, 0) + gap * (pngs.length - 1)
  const out = new PNG({ width, height })
  const [br, bg, bb] = [background >> 16 & 0xff, background >> 8 & 0xff, background & 0xff]
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = br
    out.data[i + 1] = bg
    out.data[i + 2] = bb
    out.data[i + 3] = 0xff
  }
  let y = 0
  for (const p of pngs) {
    PNG.bitblt(p, out, 0, 0, p.width, p.height, Math.floor((width - p.width) / 2), y)
    y += p.height + gap
  }
  return out
}

/** One-row contact sheet at half scale — the eyeball-check artifact. */
function contactSheet(pngs, cellWidth = 360) {
  const scale = cellWidth / pngs[0].width
  const cellHeight = Math.round(pngs[0].height * scale)
  const out = new PNG({ width: (cellWidth + 4) * pngs.length, height: cellHeight })
  out.data.fill(0xff)
  pngs.forEach((src, i) => {
    const cell = new PNG({ width: cellWidth, height: cellHeight })
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        const sx = Math.min(src.width - 1, Math.round(x / scale))
        const sy = Math.min(src.height - 1, Math.round(y / scale))
        const si = (sy * src.width + sx) * 4
        const di = (y * cellWidth + x) * 4
        for (let c = 0; c < 4; c++) cell.data[di + c] = src.data[si + c]
      }
    }
    PNG.bitblt(cell, out, 0, 0, cellWidth, cellHeight, i * (cellWidth + 4), 0)
  })
  return out
}

// --- hero GIF ----------------------------------------------------------------

const heroPngs = manifest.hero.map((frame) => downscale2x(loadPng(join(runDir, frame.file))))
const width = heroPngs[0].width
const height = heroPngs[0].height
for (const p of heroPngs) {
  if (p.width !== width || p.height !== height) throw new Error('hero frames differ in size')
}

// One global palette from the most complex frame (the fully rendered one, the
// second-to-last) keeps colors stable across frames and the file small.
const paletteSource = heroPngs[heroPngs.length - 2]
const palette = quantize(paletteSource.data, 256, { format: 'rgb565' })

const gif = GIFEncoder()
heroPngs.forEach((p, i) => {
  const index = applyPalette(p.data, palette, 'rgb565')
  gif.writeFrame(index, width, height, { palette, delay: manifest.hero[i].durationMs, repeat: 0 })
})
gif.finish()

const gifBytes = gif.bytes()
const totalMs = manifest.hero.reduce((sum, f) => sum + f.durationMs, 0)
writeFileSync(join(assetsDir, 'hero-markdown-composer.gif'), gifBytes)

// --- statics -----------------------------------------------------------------

writeFileSync(
  join(assetsDir, 'render-vs-source.png'),
  PNG.sync.write(
    stackVertical([
      loadPng(join(runDir, 'static/render-vs-source-render.png')),
      loadPng(join(runDir, 'static/render-vs-source-source.png')),
    ]),
  ),
)
writeFileSync(
  join(assetsDir, 'paste-conversion.png'),
  PNG.sync.write(
    stackVertical([
      trimBottom(loadPng(join(runDir, 'static/paste-conversion-rich.png'))),
      loadPng(join(runDir, 'static/paste-conversion-markdown.png')),
    ]),
  ),
)
writeFileSync(join(assetsDir, 'bubble-markdown.png'), readFileSync(join(runDir, 'static/bubble-markdown.png')))

// --- QA sheet + spec report ----------------------------------------------------

writeFileSync(join(runDir, 'qa-sheet.png'), PNG.sync.write(contactSheet(heroPngs)))

const spec = [
  ['width <= 1000px', width <= 1000, `${width}px`],
  ['duration 8-15s', totalMs >= 8000 && totalMs <= 15000, `${(totalMs / 1000).toFixed(1)}s`],
  ['size < 10MB', gifBytes.length < 10 * 1024 * 1024, `${(gifBytes.length / 1024).toFixed(0)}KB`],
  ['loop forever', true, 'repeat 0'],
]
let ok = true
for (const [label, pass, value] of spec) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${value}`)
  if (!pass) ok = false
}
console.log(`frames: ${heroPngs.length} @ ${width}x${height}`)
console.log(`qa sheet: ${join(runDir, 'qa-sheet.png')}`)
console.log(`assets written to ${assetsDir}`)
process.exit(ok ? 0 : 1)
