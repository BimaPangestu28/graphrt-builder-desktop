import { readRunAnswer } from './runAnswer'

describe('readRunAnswer', () => {
  it('reads the text a run answered with, not its one-line summary', () => {
    expect(readRunAnswer({ result: '  We open at 9.  ', summary: 'Answered 1 question' })).toBe('We open at 9.')
    expect(readRunAnswer({ note: 'Extra', reply: 'Hello', message: 'Not this one' })).toBe('Hello')
  })

  it('joins texts that are not named like an answer, and ignores what is not text', () => {
    expect(readRunAnswer({ draft: 'First part', closing: 'Second part', items: [{ name: 'x' }], sent: 2 })).toBe('First part\n\nSecond part')
  })

  it('has no answer for a run that only reports a summary, items or counts, or has not finished', () => {
    expect(readRunAnswer({ summary: 'Sent 3 offers', messages_sent: 3, items: [] })).toBeNull()
    expect(readRunAnswer({ result: '   ' })).toBeNull()
    expect(readRunAnswer(null)).toBeNull()
    expect(readRunAnswer(undefined)).toBeNull()
  })
})
