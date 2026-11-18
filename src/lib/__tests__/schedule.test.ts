import {
  buildCronExpression,
  describeCronExpression,
  describeCronSchedule,
  formatFireTime,
  formatZonedIsoDate,
  listUpcomingFireTimes,
  parseCronExpression,
  parseTimeOfDay,
  toMissedRunPolicy,
} from '@/lib/schedule'

describe('buildCronExpression', () => {
  it('builds weekdays at 09:00 with seconds', () => {
    expect(buildCronExpression({ frequency: 'weekdays', time: '09:00' })).toBe('0 0 9 * * Mon-Fri')
  })

  it('builds every day and custom weekdays', () => {
    expect(buildCronExpression({ frequency: 'daily', time: '07:30' })).toBe('0 30 7 * * *')
    expect(buildCronExpression({ frequency: 'custom', time: '18:05', customWeekdays: [5, 1, 3, 1] })).toBe('0 5 18 * * Mon,Wed,Fri')
  })

  it('returns null for manual runs, bad times and no weekdays', () => {
    expect(buildCronExpression({ frequency: 'manual', time: '09:00' })).toBeNull()
    expect(buildCronExpression({ frequency: 'daily', time: '25:00' })).toBeNull()
    expect(buildCronExpression({ frequency: 'custom', time: '09:00', customWeekdays: [] })).toBeNull()
  })
})

describe('parseCronExpression and describing', () => {
  it('describes weekdays back to "Weekdays 09:00"', () => {
    expect(describeCronExpression('0 0 9 * * Mon-Fri')).toBe('Weekdays 09:00')
    expect(describeCronSchedule('0 0 9 * * Mon-Fri')).toBe('Weekdays at 09:00')
  })

  it('reads names, numbers, lists and wrapping ranges', () => {
    expect(describeCronExpression('0 0 7 * * *')).toBe('Every day 07:00')
    expect(describeCronExpression('0 0 10 * * Mon')).toBe('Mondays 10:00')
    expect(describeCronExpression('0 15 8 * * 1,3,5')).toBe('Mon, Wed, Fri 08:15')
    expect(parseCronExpression('0 0 9 * * Sat-Sun')?.weekdays).toEqual([0, 6])
    expect(parseCronExpression('0 0 9 * * Fri-Mon')?.weekdays).toEqual([0, 1, 5, 6])
  })

  it('leaves expressions it cannot read unchanged', () => {
    expect(parseCronExpression('0 9 * * 1-5')).toBeNull()
    expect(parseCronExpression('0 */5 * * * *')).toBeNull()
    expect(describeCronExpression('0 0 9 1 * *')).toBe('0 0 9 1 * *')
    expect(describeCronSchedule('nonsense')).toBe('Cron nonsense')
  })

  it('parses times of day', () => {
    expect(parseTimeOfDay('9:05')).toEqual({ hour: 9, minute: 5 })
    expect(parseTimeOfDay('12:60')).toBeNull()
  })
})

describe('listUpcomingFireTimes', () => {
  const wednesdayMorningJakarta = new Date('2026-11-18T03:00:00Z') // 10:00 WIB

  it('skips today once the time has passed and skips weekends', () => {
    expect(listUpcomingFireTimes('0 0 9 * * Mon-Fri', 'Asia/Jakarta', 4, wednesdayMorningJakarta)).toEqual([
      '2026-11-19T02:00:00Z',
      '2026-11-20T02:00:00Z',
      '2026-11-23T02:00:00Z',
      '2026-11-24T02:00:00Z',
    ])
  })

  it('includes later today', () => {
    expect(listUpcomingFireTimes('0 30 18 * * *', 'Asia/Jakarta', 1, wednesdayMorningJakarta)).toEqual(['2026-11-18T11:30:00Z'])
  })

  it('throws on unsupported input', () => {
    expect(() => listUpcomingFireTimes('bad', 'Asia/Jakarta', 1)).toThrow('Unsupported schedule')
    expect(() => listUpcomingFireTimes('0 0 9 * * *', 'Mars/Base', 1)).toThrow('Unknown time zone')
  })
})

describe('formatting', () => {
  it('formats fire times and dates in the schedule zone', () => {
    expect(formatFireTime('2026-11-19T02:00:00Z', 'Asia/Jakarta')).toBe('Thu 19 Nov 09:00')
    expect(formatZonedIsoDate(new Date('2026-11-18T20:00:00Z'), 'Asia/Jakarta')).toBe('2026-11-19')
  })

  it('maps missed-run choices to policies', () => {
    expect(toMissedRunPolicy('Run once when it wakes up')).toBe('run_once')
    expect(toMissedRunPolicy('Skip the missed run')).toBe('skip')
    expect(toMissedRunPolicy('something else')).toBe('run_once')
  })
})
