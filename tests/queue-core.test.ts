/**
 * Seam: the queue view-model core — the pure half of the card's queue
 * strip (issue #30). The takeover card feeds it the input currency's
 * `queue` rows and the session snapshot's `pendingSubmissions` echoes and
 * renders what comes back; the assertions here are the native QueueDock's
 * row math (dedupe against transcript echoes, optimistic rows appended in
 * FIFO order) stated as data-in/data-out.
 */
import { describe, expect, it } from 'vitest'
import {
  contentText, previewText, queueMutableOf, queueViewRows,
  type QueueContentBlock, type QueueRow, type QueueSubmissionEcho,
} from '../src/client/queue-core.ts'

function row(id: string, text: string, rpcId?: string): QueueRow {
  return {
    id,
    content: [{ type: 'text', text }],
    ...(rpcId === undefined ? {} : { source: { kind: 'user', rpcId } }),
  }
}

function echo(requestId: string, placement: string, text = `echo ${requestId}`): QueueSubmissionEcho {
  return { requestId, placement, text }
}

describe('queueViewRows', () => {
  it('renders nothing from empty planes', () => {
    expect(queueViewRows([], [])).toEqual([])
  })

  it('passes durable rows through and appends unadmitted queued echoes', () => {
    const view = queueViewRows(
      [row('m1', 'first')],
      [echo('r1', 'queued')],
    )
    expect(view).toEqual([
      { kind: 'queued', id: 'm1', content: [{ type: 'text', text: 'first' }] },
      { kind: 'sending', id: 'r1', text: 'echo r1' },
    ])
  })

  it('hides durable rows whose transcript-placed echo already owns the seat', () => {
    const view = queueViewRows(
      [row('m1', 'first', 'r1'), row('m2', 'second')],
      [echo('r1', 'transcript')],
    )
    expect(view).toEqual([
      { kind: 'queued', id: 'm2', content: [{ type: 'text', text: 'second' }] },
    ])
  })

  it('keeps a durable row once its queued echo is admitted (rpcId matched)', () => {
    const view = queueViewRows(
      [row('m1', 'first', 'r1')],
      [echo('r1', 'queued')],
    )
    expect(view).toEqual([
      { kind: 'queued', id: 'm1', content: [{ type: 'text', text: 'first' }] },
    ])
  })

  it('ignores steering-placed echoes', () => {
    const view = queueViewRows([], [echo('r1', 'steering')])
    expect(view).toEqual([])
  })

  it('skips rows whose user source carries no rpcId and non-user sources', () => {
    const view = queueViewRows(
      [
        { id: 'm1', content: [{ type: 'text', text: 'plain' }] },
        { id: 'm2', content: [{ type: 'text', text: 'sys' }], source: { kind: 'system-prompt' } },
      ],
      [echo('r1', 'transcript')],
    )
    expect(view).toEqual([
      { kind: 'queued', id: 'm1', content: [{ type: 'text', text: 'plain' }] },
      { kind: 'queued', id: 'm2', content: [{ type: 'text', text: 'sys' }] },
    ])
  })
})

describe('previewText', () => {
  it('joins text blocks and marks non-text ones', () => {
    const content: QueueContentBlock[] = [
      { type: 'text', text: 'check ' },
      { type: 'image' },
      { type: 'text', text: 'this' },
      { type: 'file' },
    ]
    expect(previewText(content)).toBe('check [image] this [file]')
  })

  it('collapses whitespace runs', () => {
    expect(previewText([{ type: 'text', text: 'a\n\n  b\tc' }])).toBe('a b c')
  })

  it('truncates past 200 characters by code point and marks it', () => {
    const long = '好'.repeat(300)
    const preview = previewText([{ type: 'text', text: long }])
    expect(Array.from(preview)).toHaveLength(201)
    expect(preview.endsWith('…')).toBe(true)
  })
})

describe('contentText', () => {
  it('joins all-text rows', () => {
    expect(contentText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab')
  })

  it('answers null when any block is not text', () => {
    expect(contentText([{ type: 'text', text: 'a' }, { type: 'image' }])).toBeNull()
  })
})

describe('queueMutableOf', () => {
  it('is mutable without a subagent and unmutable without a snapshot', () => {
    expect(queueMutableOf(null)).toBe(true)
    expect(queueMutableOf(undefined)).toBe(false)
  })

  it('follows the subagent address mode', () => {
    expect(queueMutableOf({ address: { mode: 'continuable' } })).toBe(true)
    expect(queueMutableOf({ address: { mode: 'detached' } })).toBe(false)
  })
})
