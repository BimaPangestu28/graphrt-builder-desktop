import { describeAutoStop, describeNoteTakers, formatElapsed } from './meetingDisplay'

describe('meetingDisplay', () => {
  it('formats the elapsed clock', () => {
    const start = '2026-11-26T10:00:00Z'
    expect(formatElapsed(start, Date.parse('2026-11-26T10:00:07Z'))).toBe('00:07')
    expect(formatElapsed(start, Date.parse('2026-11-26T10:12:34Z'))).toBe('12:34')
    expect(formatElapsed(start, Date.parse('2026-11-26T11:02:03Z'))).toBe('1:02:03')
    expect(formatElapsed(start, Date.parse('2026-11-26T09:00:00Z'))).toBe('00:00')
    expect(formatElapsed('not a date', 0)).toBe('00:00')
  })

  it('names the agents that get the notes', () => {
    expect(describeNoteTakers([])).toBe('No agent takes the notes yet.')
    expect(describeNoteTakers(['Meeting notes to Notion'])).toBe('Meeting notes to Notion gets the notes.')
    expect(describeNoteTakers(['A', 'B', 'C'])).toBe('A, B and C get the notes.')
  })

  it('counts down the automatic stop', () => {
    expect(describeAutoStop(12.4)).toBe('The meeting seems over. Notes stop in 12 s.')
    expect(describeAutoStop(-3)).toBe('The meeting seems over. Notes stop in 0 s.')
  })
})
