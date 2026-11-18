import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Conversation } from '@/api/conversationTypes'
import type { Agent, Run, Trigger } from '@/api/types'
import type { UsageSummary } from '@/api/usageSummaryTypes'
import { startOfLocalMonth } from '@/pages/home-dashboard/monthlyUsage'
import { HomePage } from '@/pages/HomePage'
import { routePaths } from '@/routes'
import type { CommandHandlers } from '@/test/desktopBackend'

const fakeBackend = vi.hoisted(() => ({ handlers: {} as CommandHandlers }))
vi.mock('@/api/client', async (importOriginal) => {
  const { createDesktopClient } = await import('@/test/desktopBackend')
  return createDesktopClient(await importOriginal(), fakeBackend)
})

const digestAgent: Agent = {
  id: 'digest',
  name: 'Inbox digest',
  kind: 'task',
  description: 'Summarize email',
  flowYaml: 'nodes: []',
  status: 'active',
  currentVersion: 1,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
}

const helpdeskAgent: Agent = { ...digestAgent, id: 'helpdesk', name: 'Helpdesk', kind: 'chatbot', description: 'Answers shop questions' }

function tomorrowAt(hour: number): string {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(hour, 0, 0, 0)
  return tomorrow.toISOString()
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function createTrigger(overrides: Partial<Trigger>): Trigger {
  return {
    id: 'trigger',
    agentId: digestAgent.id,
    cronExpression: '0 0 7 * * Mon-Fri',
    timezone: 'Asia/Jakarta',
    enabled: true,
    missedRunPolicy: 'run_once',
    inputs: {},
    lastFiredAt: null,
    nextFireAt: tomorrowAt(7),
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  }
}

const pausedRun: Run = {
  id: 'run-1',
  agentId: digestAgent.id,
  agentVersion: 1,
  trigger: 'schedule',
  status: 'paused',
  startedAt: minutesAgo(30),
  finishedAt: null,
  outputs: null,
  errorMessage: null,
  pauseReasons: [{ node_id: 'approve', kind: 'human_input', data: { prompt: 'Send the digest?' } }],
}

function createWaitingChat(id: string, updatedAt: string): Conversation {
  return {
    id,
    agentId: helpdeskAgent.id,
    channel: 'test',
    customerName: '[CUSTOMER]',
    customerHandle: '[HANDLE]',
    status: 'waiting_for_you',
    origin: null,
    handoffReason: 'asked_for_person',
    summary: null,
    suggestedReply: null,
    variables: {},
    lastMessageText: 'Can I talk to someone?',
    lastMessageAuthor: 'customer',
    createdAt: updatedAt,
    updatedAt,
  }
}

const monthWithRuns: UsageSummary = {
  from: '2026-11-01T00:00:00Z',
  runCount: 12,
  runsWithUsage: 9,
  usage: { promptTokens: 40_000, completionTokens: 8_300, totalTokens: 48_300 },
}

const emptyMonth: UsageSummary = { ...monthWithRuns, runCount: 0, runsWithUsage: 0, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }

interface HomeBackendData {
  pausedRuns: Run[]
  waitingChats: Conversation[]
  triggers: Trigger[]
  usageSummary: UsageSummary
}

/** Answers every command Home and its sidebar send; returns the usage summary requests. */
function answerBackend({ pausedRuns, waitingChats, triggers, usageSummary }: HomeBackendData) {
  const usageRequests: Array<Record<string, unknown>> = []
  fakeBackend.handlers = {
    list_agents: () => [digestAgent, helpdeskAgent],
    list_agent_run_stats: () => [],
    // Paused runs are also the only recent runs.
    list_runs: () => pausedRuns,
    list_conversations: () => waitingChats,
    count_conversations: () => ({ all: 0, botAnswering: 0, waitingForYou: waitingChats.length, youReplying: 0, closed: 0, fromOutreach: 0 }),
    list_triggers: () => triggers,
    get_default_model: () => ({ provider: 'deepseek', name: 'deepseek-chat' }),
    get_usage_summary: (commandArguments) => {
      usageRequests.push(commandArguments)
      return usageSummary
    },
  }
  return usageRequests
}

function renderHomePage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.home]}>
      <Routes>
        <Route path={routePaths.home} element={<HomePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomePage in the desktop app', () => {
  it('counts paused runs and waiting chats, and names the next scheduled run', async () => {
    answerBackend({
      pausedRuns: [pausedRun],
      waitingChats: [createWaitingChat('chat-1', minutesAgo(9)), createWaitingChat('chat-2', minutesAgo(3))],
      triggers: [createTrigger({ id: 'later', nextFireAt: tomorrowAt(9) }), createTrigger({ id: 'sooner' }), createTrigger({ id: 'off', enabled: false, nextFireAt: null })],
      usageSummary: monthWithRuns,
    })
    renderHomePage()
    expect(await screen.findByText('3 things need you · next run tomorrow 07:00')).toBeInTheDocument()
    const needsYou = screen.getByRole('region', { name: /Needs you/ })
    expect(within(needsYou).getByText('Inbox digest is waiting for you')).toBeInTheDocument()
    expect(within(needsYou).getByText('2 customers are waiting in Inbox')).toBeInTheDocument()
    expect(within(needsYou).getByText('Helpdesk passed them to you · oldest 9 minutes')).toBeInTheDocument()
    expect(within(needsYou).queryByText('Gmail sign-in expired')).not.toBeInTheDocument()
  })

  it('shows this month\'s real runs and tokens without cost or time saved', async () => {
    const usageRequests = answerBackend({ pausedRuns: [], waitingChats: [], triggers: [], usageSummary: monthWithRuns })
    renderHomePage()
    const thisMonth = screen.getByRole('region', { name: 'This month' })
    expect(await within(thisMonth).findByText('12')).toBeInTheDocument()
    expect(within(thisMonth).getByText('48K')).toBeInTheDocument()
    expect(within(thisMonth).queryByText(/cost|Time saved|64|\$/)).not.toBeInTheDocument()
    expect(usageRequests[0]).toEqual({ fromDate: startOfLocalMonth(new Date()).toISOString() })
  })

  it('puts the schedule from the agent\'s triggers on its card', async () => {
    answerBackend({ pausedRuns: [], waitingChats: [], triggers: [createTrigger({})], usageSummary: monthWithRuns })
    renderHomePage()
    const agentsSection = screen.getByRole('region', { name: 'Agents' })
    expect(await within(agentsSection).findByText('Weekdays 07:00')).toBeInTheDocument()
    expect(within(agentsSection).getByRole('link', { name: /Helpdesk/ })).toHaveTextContent('Chatbot · Answers shop questions')
  })

  it('shows honest empty states when nothing has happened yet', async () => {
    answerBackend({ pausedRuns: [], waitingChats: [], triggers: [], usageSummary: emptyMonth })
    renderHomePage()
    expect(await screen.findByText('Nothing needs you · no runs scheduled')).toBeInTheDocument()
    expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument()
    expect(await screen.findByText('No runs this month yet')).toBeInTheDocument()
    expect(screen.getByText('No runs yet. Test an agent to see it here')).toBeInTheDocument()
  })
})
