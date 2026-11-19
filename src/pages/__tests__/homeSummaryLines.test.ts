import type { Conversation } from '@/api/conversationTypes'
import type { Trigger } from '@/api/types'
import { describeAgentSchedule, describeNeedsYouCount, describeNextRun, formatUpcomingTime } from '@/pages/home-dashboard/homeSummaryLines'
import { buildConnectionReminderItems, buildInboxAttentionItem, formatWaitingTime } from '@/pages/home-dashboard/homeViewModel'
import { formatTokenCount, startOfLocalMonth } from '@/pages/home-dashboard/monthlyUsage'
import { countScheduledAgents } from '@/hooks/useRunnerStatus'
import { describeConnectedRunner } from '@/components/layout/Sidebar'
import { routePaths } from '@/routes'

const now = new Date(2026, 10, 18, 10, 30)

function localIso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month, day, hour, minute).toISOString()
}

function createTrigger(overrides: Partial<Trigger>): Trigger {
  return {
    id: 'trigger',
    agentId: 'agent',
    cronExpression: '0 0 9 * * Mon-Fri',
    timezone: 'Asia/Jakarta',
    enabled: true,
    missedRunPolicy: 'run_once',
    inputs: {},
    lastFiredAt: null,
    nextFireAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  }
}

function createChat(agentId: string, updatedAt: string): Conversation {
  return {
    id: `${agentId}-${updatedAt}`,
    agentId,
    channel: 'test',
    customerName: '[CUSTOMER]',
    customerHandle: '[HANDLE]',
    status: 'waiting_for_you',
    origin: null,
    handoffReason: null,
    summary: null,
    suggestedReply: null,
    variables: {},
    lastMessageText: null,
    lastMessageAuthor: null,
    createdAt: updatedAt,
    updatedAt,
  }
}

const agentName = (agentId: string) => ({ cafe: 'Cafe bot', shop: 'Shop bot', rental: 'Rental bot' })[agentId] ?? agentId

describe('Home summary lines', () => {
  it('counts what needs the user', () => {
    expect(describeNeedsYouCount(0)).toBe('Nothing needs you')
    expect(describeNeedsYouCount(1)).toBe('1 thing needs you')
    expect(describeNeedsYouCount(3)).toBe('3 things need you')
  })

  it('formats an upcoming time relative to today', () => {
    expect(formatUpcomingTime(localIso(2026, 10, 18, 16, 5), now)).toBe('today 16:05')
    expect(formatUpcomingTime(localIso(2026, 10, 19, 7), now)).toBe('tomorrow 07:00')
    expect(formatUpcomingTime(localIso(2026, 10, 23, 9), now)).toBe('Mon 23 Nov 09:00')
  })

  it('picks the earliest next fire time of enabled triggers', () => {
    const triggers = [
      createTrigger({ id: 'later', nextFireAt: localIso(2026, 10, 20, 9) }),
      createTrigger({ id: 'off', enabled: false, nextFireAt: localIso(2026, 10, 18, 11) }),
      createTrigger({ id: 'sooner', nextFireAt: localIso(2026, 10, 19, 7) }),
    ]
    expect(describeNextRun(triggers, now)).toBe('next run tomorrow 07:00')
    expect(describeNextRun([createTrigger({ enabled: false })], now)).toBe('no runs scheduled')
    expect(describeNextRun([], now)).toBe('no runs scheduled')
  })

  it('describes an agent\'s schedule from its triggers', () => {
    expect(describeAgentSchedule([])).toBeNull()
    expect(describeAgentSchedule([createTrigger({})])).toBe('Weekdays 09:00')
    expect(describeAgentSchedule([createTrigger({ enabled: false, cronExpression: '0 0 10 * * Mon' })])).toBe('Schedule off · Mondays 10:00')
    expect(describeAgentSchedule([createTrigger({}), createTrigger({ id: 'evening', cronExpression: '0 0 18 * * *' })])).toBe('Weekdays 09:00 · +1 more')
  })
})

describe('Home attention rows', () => {
  it('summarizes chats waiting in Inbox', () => {
    expect(buildInboxAttentionItem([], agentName, now)).toBeNull()
    const single = buildInboxAttentionItem([createChat('cafe', new Date(now.getTime() - 5 * 60_000).toISOString())], agentName, now)
    expect(single).toMatchObject({ title: '1 customer is waiting in Inbox', detail: 'Cafe bot passed it to you · waiting 5 minutes', actionPath: routePaths.inbox })
    const several = buildInboxAttentionItem(
      [createChat('cafe', new Date(now.getTime() - 2 * 3_600_000).toISOString()), createChat('shop', new Date(now.getTime() - 60_000).toISOString())],
      agentName,
      now,
    )
    expect(several?.detail).toBe('Cafe bot and Shop bot passed them to you · oldest 2 hours')
    const manyAgents = buildInboxAttentionItem(['cafe', 'shop', 'rental'].map((agentId) => createChat(agentId, now.toISOString())), agentName, now)
    expect(manyAgents?.detail).toBe('Your chatbots passed them to you · oldest 1 minute')
  })

  it('formats waiting time in minutes, hours or days', () => {
    expect(formatWaitingTime(new Date(now.getTime() - 3 * 86_400_000).toISOString(), now)).toBe('3 days')
  })

  it('turns connection reminders into rows that open Connections', () => {
    const [row] = buildConnectionReminderItems([{ id: 'gmail', title: 'Gmail sign-in expired', detail: 'Digest failed', actionLabel: 'Reconnect Gmail' }])
    expect(row).toMatchObject({ id: 'connection-gmail', actionLabel: 'Reconnect Gmail', actionPath: routePaths.connections, isPrimaryAction: false })
  })
})

describe('This month card', () => {
  it('starts the window at local midnight on the 1st', () => {
    expect(startOfLocalMonth(now)).toEqual(new Date(2026, 10, 1))
  })

  it('formats token counts briefly', () => {
    expect(formatTokenCount(850)).toBe('850')
    expect(formatTokenCount(4_200)).toBe('4.2K')
    expect(formatTokenCount(5_000)).toBe('5K')
    expect(formatTokenCount(412_200)).toBe('412K')
    expect(formatTokenCount(1_250_000)).toBe('1.3M')
  })
})

describe('Runner card line', () => {
  it('counts agents with at least one schedule on', () => {
    const triggers = [createTrigger({ agentId: 'a' }), createTrigger({ agentId: 'a' }), createTrigger({ agentId: 'b', enabled: false })]
    expect(countScheduledAgents(triggers)).toBe(1)
  })

  it('names the provider and the scheduled agents', () => {
    expect(describeConnectedRunner({ defaultModel: { provider: 'deepseek', name: 'deepseek-chat' }, scheduledAgentCount: 2 })).toBe('DeepSeek connected · 2 agents scheduled')
    expect(describeConnectedRunner({ defaultModel: { provider: 'ollama', name: 'llama3' }, scheduledAgentCount: 0 })).toBe('Ollama connected')
    expect(describeConnectedRunner({ defaultModel: null, scheduledAgentCount: 3 })).toBeNull()
  })
})
