import type { ReleaseReadiness } from '@/api/qualityTypes'
import { messages } from '@/i18n'
import { describeNotGood, describeReadiness, needsCheck, textToWords, wordsToText } from './qualityDisplay'

describe('qualityDisplay', () => {
  const t = messages().quality

  it('turns a comma separated field into words and back', () => {
    expect(textToWords(' 9 am, , morning ,')).toEqual(['9 am', 'morning'])
    expect(wordsToText(['9 am', 'morning'])).toBe('9 am, morning')
  })

  it('says why an answer was not good', () => {
    expect(describeNotGood({ kind: 'missing_words', words: ['price'] }, t)).toBe('It does not mention "price"')
    expect(describeNotGood({ kind: 'judge', text: 'It leaves out the price.' }, t)).toBe('It leaves out the price.')
    expect(describeNotGood({ kind: 'no_answer', message: 'the agent took too long to answer' }, t)).toBe('The agent did not answer: the agent took too long to answer')
  })

  it('says why a version cannot be released and whether a check fixes it', () => {
    const notEnough: ReleaseReadiness = { status: 'blocked', block: { kind: 'not_enough_good', good: 6, total: 10, needed: 8, requiredPercent: 80 }, canOverride: true, checkId: 'c' }
    expect(describeReadiness(notEnough, t)).toBe('Only 6 of 10 answers were good. A release needs at least 8. Improve the agent or the questions, then check again.')
    expect(needsCheck(notEnough)).toBe(true)
    const released: ReleaseReadiness = { status: 'blocked', block: { kind: 'already_released', number: 2 }, canOverride: false, checkId: null }
    expect(needsCheck(released)).toBe(false)
    expect(describeReadiness({ status: 'ready', checkId: 'c', good: 8, total: 10 }, t)).toBeNull()
  })
})
