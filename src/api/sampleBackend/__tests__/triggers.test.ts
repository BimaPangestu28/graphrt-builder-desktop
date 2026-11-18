import { resetSampleTriggers, sampleTriggersBackend } from '../triggers'

const newWeekdayTrigger = {
  agentId: 'maps-leads',
  cronExpression: '0 30 8 * * Mon-Fri',
  timezone: 'Asia/Jakarta',
  missedRunPolicy: 'skip' as const,
  inputs: { city: 'Metro' },
}

describe('sample triggers backend', () => {
  beforeEach(() => {
    resetSampleTriggers()
  })

  it('seeds the Scheduler screen triggers', async () => {
    const triggers = await sampleTriggersBackend.listTriggers()
    expect(triggers.map((trigger) => [trigger.id, trigger.cronExpression, trigger.enabled])).toEqual([
      ['maps-leads', '0 0 9 * * Mon-Fri', true],
      ['morning-digest', '0 0 7 * * *', true],
      ['invoice-reminders', '0 0 10 * * Mon', false],
    ])
    expect(triggers[0].nextFireAt).toMatch(/^\d{4}-\d\d-\d\dT02:00:00Z$/)
    expect(triggers[2].nextFireAt).toBeNull()
    expect(await sampleTriggersBackend.listTriggers('morning-digest')).toHaveLength(1)
  })

  it('creates, updates and deletes triggers', async () => {
    const createdTrigger = await sampleTriggersBackend.createTrigger(newWeekdayTrigger)
    expect(createdTrigger).toMatchObject({ ...newWeekdayTrigger, enabled: true, lastFiredAt: null })
    expect(createdTrigger.nextFireAt).toMatch(/T01:30:00Z$/)

    const updatedTrigger = await sampleTriggersBackend.updateTrigger(createdTrigger.id, { ...newWeekdayTrigger, cronExpression: '0 0 18 * * *' })
    expect(updatedTrigger.cronExpression).toBe('0 0 18 * * *')
    expect(updatedTrigger.nextFireAt).toMatch(/T11:00:00Z$/)

    await sampleTriggersBackend.deleteTrigger(createdTrigger.id)
    expect((await sampleTriggersBackend.listTriggers()).map((trigger) => trigger.id)).not.toContain(createdTrigger.id)
  })

  it('turns triggers on and off', async () => {
    const pausedTrigger = await sampleTriggersBackend.setTriggerEnabled('maps-leads', false)
    expect(pausedTrigger).toMatchObject({ enabled: false, nextFireAt: null })
    const resumedTrigger = await sampleTriggersBackend.setTriggerEnabled('maps-leads', true)
    expect(resumedTrigger.nextFireAt).not.toBeNull()
  })

  it('rejects bad schedules and unknown triggers', async () => {
    await expect(sampleTriggersBackend.createTrigger({ ...newWeekdayTrigger, cronExpression: '0 9 * * 1-5' })).rejects.toMatchObject({ code: 'schedule' })
    await expect(sampleTriggersBackend.createTrigger({ ...newWeekdayTrigger, timezone: 'Mars/Base' })).rejects.toMatchObject({ code: 'schedule' })
    await expect(sampleTriggersBackend.setTriggerEnabled('nope', true)).rejects.toMatchObject({ code: 'not_found' })
    await expect(sampleTriggersBackend.deleteTrigger('nope')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('previews upcoming fire times', async () => {
    const fireTimes = await sampleTriggersBackend.previewSchedule('0 0 9 * * Mon-Fri', 'Asia/Jakarta', 5)
    expect(fireTimes).toHaveLength(5)
    expect(fireTimes.every((fireTime) => fireTime.endsWith('T02:00:00Z'))).toBe(true)
    expect([...fireTimes].sort()).toEqual(fireTimes)
    await expect(sampleTriggersBackend.previewSchedule('nonsense', 'Asia/Jakarta', 5)).rejects.toMatchObject({ code: 'schedule' })
  })
})
