import '@testing-library/jest-dom/vitest'

// CodeMirror's measure path reads DOM Range client rects, which jsdom does
// not implement; zero rects are enough for the editor to mount and answer.
if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = function getClientRects(): DOMRectList {
    return [] as unknown as DOMRectList
  }
  Range.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0,
      toJSON: () => ({}) } as DOMRect
  }
}
