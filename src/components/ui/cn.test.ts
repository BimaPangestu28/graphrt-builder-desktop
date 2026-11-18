import { joinClassNames } from './cn'

describe('joinClassNames', () => {
  it('drops falsy values', () => {
    expect(joinClassNames('px-2', false, null, undefined, 'py-1')).toBe('px-2 py-1')
  })

  it('lets a later class override a conflicting earlier one', () => {
    expect(joinClassNames('h-10 font-semibold', 'h-9 font-medium')).toBe('h-9 font-medium')
  })

  it('keeps custom token colors and font sizes apart', () => {
    expect(joinClassNames('text-[13px] text-ink', 'text-muted')).toBe('text-[13px] text-muted')
  })
})
