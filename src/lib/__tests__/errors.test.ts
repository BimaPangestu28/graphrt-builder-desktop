import { genericErrorMessage, toError, toErrorMessage } from '../errors'

describe('toError', () => {
  it('returns the same Error instance', () => {
    const original = new TypeError('boom')
    expect(toError(original)).toBe(original)
  })

  it('wraps a thrown string', () => {
    expect(toError('Disk full').message).toBe('Disk full')
  })

  it('reads the message of a plain object', () => {
    expect(toError({ code: 'not_found', message: 'No such agent' }).message).toBe('No such agent')
  })

  it.each([undefined, null, 42, '', '   ', { code: 'x' }])('falls back to the generic message for %p', (rawError) => {
    expect(toError(rawError).message).toBe(genericErrorMessage)
  })
})

describe('toErrorMessage', () => {
  it('returns the Error message', () => {
    expect(toErrorMessage(new Error('Not found'))).toBe('Not found')
  })

  it('falls back when an Error has an empty message', () => {
    expect(toErrorMessage(new Error(''))).toBe(genericErrorMessage)
  })

  it('falls back for values without a message', () => {
    expect(toErrorMessage(7)).toBe(genericErrorMessage)
  })
})
