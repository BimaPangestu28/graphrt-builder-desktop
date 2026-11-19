import { describe, expect, it } from 'vitest'
import { toPreviewText } from '@/lib/previewText'

describe('toPreviewText', () => {
  it('leaves plain one-line text as it is', () => {
    expect(toPreviewText('11 sent · 1 skipped')).toBe('11 sent · 1 skipped')
  })

  it('collapses line breaks, tabs and repeated spaces into single spaces', () => {
    expect(toPreviewText('  Send this promotion?\n\nSubject:\tHello   there\r\n')).toBe('Send this promotion? Subject: Hello there')
  })

  it('strips bold, italic and inline code markers', () => {
    expect(toPreviewText('**11 sent**, __2 queued__, *one* _skipped_ and `retry` later')).toBe('11 sent, 2 queued, one skipped and retry later')
  })

  it('keeps underscores and asterisks inside words and numbers', () => {
    expect(toPreviewText('ACCESS_TOKEN missing for 2*3 runs')).toBe('ACCESS_TOKEN missing for 2*3 runs')
  })

  it('strips headings, list markers and quotes at line starts', () => {
    expect(toPreviewText('## Summary\n- 3 cafes found\n* 2 messaged\n1. one failed\n> note')).toBe('Summary 3 cafes found 2 messaged one failed note')
  })

  it('keeps link and image text but drops their addresses', () => {
    expect(toPreviewText('See [the report](https://example.com/r) ![chart](c.png)')).toBe('See the report chart')
  })

  it('drops code fences but keeps their content', () => {
    expect(toPreviewText('```json\n{"sent": 3}\n```')).toBe('{"sent": 3}')
  })

  it('returns an empty string for whitespace only', () => {
    expect(toPreviewText(' \n\t ')).toBe('')
  })
})
