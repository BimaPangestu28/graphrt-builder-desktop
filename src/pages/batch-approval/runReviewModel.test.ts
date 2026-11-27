import type { RunReview } from '@/api/runReviewTypes'
import { summarizeAnswers } from './runReviewModel'

function reviewWith(answered: RunReview['answered']): RunReview {
  return { answered } as Pick<RunReview, 'answered'> as RunReview
}

describe('summarizeAnswers', () => {
  it('names answered buttons by their title, also when no question is pending any more', () => {
    const review = reviewWith([
      { nodeId: 'approve', frame: '', action: 'create', actionTitle: 'Buat invoice', index: null, answeredAt: '2026-11-27T12:00:00Z' },
      { nodeId: 'approve', frame: '', action: 'create', actionTitle: 'Buat invoice', index: null, answeredAt: '2026-11-27T12:01:00Z' },
      { nodeId: 'approve', frame: '', action: 'cancel', actionTitle: null, index: null, answeredAt: '2026-11-27T12:02:00Z' },
    ])
    expect(summarizeAnswers(review, new Map())).toBe('Buat invoice 2 · cancel 1')
    expect(summarizeAnswers(review, new Map([['cancel', 'Batal']]))).toBe('Buat invoice 2 · Batal 1')
    expect(summarizeAnswers(reviewWith([]), new Map())).toBeNull()
  })
})
