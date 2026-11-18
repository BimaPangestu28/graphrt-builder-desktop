import { BackendError } from '../../client'
import { sampleConnectionRemindersBackend } from '../connectionReminders'
import { sampleUsageSummaryBackend } from '../usageSummary'

describe('sample usage summary backend', () => {
  it('returns the design\'s month with consistent token totals', async () => {
    const summary = await sampleUsageSummaryBackend.getUsageSummary('2026-11-01T00:00:00+07:00')
    expect(summary.from).toBe('2026-10-31T17:00:00.000Z')
    expect(summary.runCount).toBe(64)
    expect(summary.runsWithUsage).toBeLessThanOrEqual(summary.runCount)
    expect(summary.usage.totalTokens).toBe(summary.usage.promptTokens + summary.usage.completionTokens)
  })

  it('rejects a time it cannot read like the backend does', async () => {
    await expect(sampleUsageSummaryBackend.getUsageSummary('November')).rejects.toBeInstanceOf(BackendError)
  })
})

describe('sample connection reminders backend', () => {
  it('returns copies of the design\'s Gmail reminder', async () => {
    const [first] = await sampleConnectionRemindersBackend.listConnectionReminders()
    first.title = 'changed'
    const [second] = await sampleConnectionRemindersBackend.listConnectionReminders()
    expect(second.title).toBe('Gmail sign-in expired')
  })
})
