import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Conversation } from '@/api/conversationTypes'
import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import type { Agent, Run, Trigger } from '@/api/types'
import type { UsageSummary } from '@/api/usageSummaryTypes'
import { gettingStartedDismissedKey } from '@/pages/home-dashboard/gettingStarted'
import { startOfLocalMonth } from '@/pages/home-dashboard/monthlyUsage'
import { HomePage } from '@/pages/HomePage'
import { agentPath, routePaths } from '@/routes'
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

const promoAgent: Agent = {
  ...digestAgent,
  id: 'promo',
  name: 'Cafe promo',
  status: 'draft',
  description: 'Find cafes in Bandung on Google Maps and send each one our promotion on WhatsApp, then log replies',
}

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

const dnsError = 'connection: iteration item 0 failed: error sending request for url (https://promo.example.com/send): client error (Connect): dns error: failed to lookup address information'

function createFailedTestRun(id: string, startedAt: string): Run {
  return { ...pausedRun, id, agentId: promoAgent.id, trigger: 'test', status: 'failed', startedAt, finishedAt: startedAt, pauseReasons: null, errorMessage: dnsError }
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

const whatsappRequirement: PluginRequirement = {
  name: 'whatsapp-api',
  displayName: 'WhatsApp Cloud API',
  description: 'Send WhatsApp messages',
  usedBySteps: ['Send the promotion'],
  permissions: { network: true, secrets: true, env: ['ACCESS_TOKEN'] },
  needsBrowser: false,
  warning: null,
  installed: true,
  trusted: true,
  trustNotNeeded: false,
  missingConfig: ['ACCESS_TOKEN'],
  browserReady: true,
  needsSession: false,
  sessionLinked: true,
  ready: false,
}

const monthWithRuns: UsageSummary = {
  from: '2026-11-01T00:00:00Z',
  runCount: 2,
  runsWithUsage: 2,
  usage: { promptTokens: 400, completionTokens: 168, totalTokens: 568 },
}

const emptyMonth: UsageSummary = { ...monthWithRuns, runCount: 0, runsWithUsage: 0, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }

interface HomeBackendData {
  agents: Agent[]
  runs: Run[]
  waitingChats: Conversation[]
  triggers: Trigger[]
  usageSummary: UsageSummary
  pluginRequirements?: Record<string, PluginRequirement[]>
  isModelConnected?: boolean
}

/** Answers every command Home and its sidebar send; returns the usage summary requests. */
function answerBackend({ agents, runs, waitingChats, triggers, usageSummary, pluginRequirements = {}, isModelConnected = true }: HomeBackendData) {
  const usageRequests: Array<Record<string, unknown>> = []
  fakeBackend.handlers = {
    list_agents: () => agents,
    list_agent_run_stats: () => [],
    list_runs: () => runs,
    list_conversations: () => waitingChats,
    count_conversations: () => ({ all: 0, botAnswering: 0, waitingForYou: waitingChats.length, youReplying: 0, closed: 0, fromOutreach: 0 }),
    list_triggers: () => triggers,
    list_problems: () => [],
    list_agent_plugin_requirements: (commandArguments) => pluginRequirements[commandArguments.agentId as string] ?? [],
    list_provider_statuses: () => [{ provider: 'deepseek', configured: isModelConnected, baseUrl: null }],
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
  beforeEach(() => window.localStorage.removeItem(gettingStartedDismissedKey))

  it('puts approvals, chats, failed runs and unready plugins in "Needs you", most urgent first', async () => {
    answerBackend({
      agents: [digestAgent, helpdeskAgent, promoAgent],
      runs: [createFailedTestRun('promo-2', minutesAgo(5)), pausedRun, createFailedTestRun('promo-1', minutesAgo(60))],
      waitingChats: [createWaitingChat('chat-1', minutesAgo(9)), createWaitingChat('chat-2', minutesAgo(3))],
      triggers: [createTrigger({ id: 'later', nextFireAt: tomorrowAt(9) }), createTrigger({ id: 'sooner' }), createTrigger({ id: 'off', enabled: false, nextFireAt: null })],
      usageSummary: monthWithRuns,
      pluginRequirements: { promo: [whatsappRequirement] },
    })
    renderHomePage()
    expect(await screen.findByText('4 things need you · next run tomorrow 07:00')).toBeInTheDocument()
    const needsYou = screen.getByRole('region', { name: /Needs you/ })
    // Plugin requirements load after the agents, so the setup row comes in last.
    await within(needsYou).findByText("Cafe promo isn't ready to run")
    expect(within(needsYou).getAllByRole('listitem').map((row) => row.querySelector('.font-semibold')?.textContent)).toEqual([
      'Inbox digest is waiting for you',
      '2 customers are waiting in Inbox',
      'Cafe promo failed its test',
      "Cafe promo isn't ready to run",
    ])
    expect(within(needsYou).getByText('Helpdesk passed them to you · oldest 9 minutes')).toBeInTheDocument()
    const failedRow = within(needsYou).getByText('Cafe promo failed its test').closest('li') as HTMLElement
    expect(within(failedRow).getByText(/^Could not reach promo\.example\.com: that address doesn't exist · Today \d\d:\d\d$/)).toBeInTheDocument()
    expect(within(failedRow).getByRole('link', { name: 'See what went wrong' })).toHaveAttribute('href', `${routePaths.errorStates}?runId=promo-2`)
    const setupRow = within(needsYou).getByText("Cafe promo isn't ready to run").closest('li') as HTMLElement
    expect(within(setupRow).getByText('WhatsApp Cloud API needs ACCESS_TOKEN')).toBeInTheDocument()
    expect(within(setupRow).getByRole('link', { name: 'Set up' })).toHaveAttribute('href', agentPath('builder', 'promo'))
    expect(screen.queryByText(/dns error/)).not.toBeInTheDocument()
  })

  it('shows a failed draft as "Test failed" with what went wrong and its plugins', async () => {
    answerBackend({
      agents: [promoAgent],
      runs: [createFailedTestRun('promo-2', minutesAgo(5)), createFailedTestRun('promo-1', minutesAgo(60))],
      waitingChats: [],
      triggers: [],
      usageSummary: monthWithRuns,
      pluginRequirements: { promo: [whatsappRequirement, { ...whatsappRequirement, name: 'google-maps', displayName: 'Google Maps', missingConfig: [], ready: true }] },
    })
    renderHomePage()
    const promoCard = await screen.findByRole('article', { name: 'Cafe promo' })
    expect(await within(promoCard).findByText('Test failed')).toBeInTheDocument()
    expect(within(promoCard).getByRole('link', { name: 'See what went wrong' })).toHaveAttribute('href', `${routePaths.errorStates}?runId=promo-2`)
    expect(within(promoCard).getByText(promoAgent.description)).toHaveAttribute('title', promoAgent.description)
    const plugins = await within(promoCard).findByRole('list', { name: 'Plugins' })
    expect(within(plugins).getByText('WhatsApp Cloud API').closest('li')).toHaveTextContent('(not ready)')
    expect(within(plugins).getByText('Google Maps').closest('li')).toHaveTextContent('(ready)')

    const recentRuns = screen.getByRole('region', { name: 'Recent runs' })
    expect(within(recentRuns).getAllByText("Could not reach promo.example.com: that address doesn't exist")).toHaveLength(2)
    expect(within(recentRuns).getByText('5 min ago')).toBeInTheDocument()

    const thisMonth = screen.getByRole('region', { name: 'This month' })
    expect(await within(thisMonth).findByText('568')).toBeInTheDocument()
    expect(within(thisMonth).getByText('Runs failed').nextElementSibling).toHaveTextContent('2')
    expect(within(thisMonth).getByText('Runs succeeded').nextElementSibling).toHaveTextContent('0')

    const checklist = await screen.findByRole('region', { name: /Getting started/ })
    expect(within(checklist).getByText('2 of 5 done')).toBeInTheDocument()
    expect(within(checklist).getByRole('link', { name: 'Pass a test run' })).toHaveAttribute('href', agentPath('testRun', 'promo'))
  })

  it('offers "Test it" on an untested draft', async () => {
    answerBackend({ agents: [promoAgent], runs: [], waitingChats: [], triggers: [], usageSummary: emptyMonth })
    renderHomePage()
    const promoCard = await screen.findByRole('article', { name: 'Cafe promo' })
    expect(await within(promoCard).findByText('Draft · not tested')).toBeInTheDocument()
    expect(within(promoCard).getByRole('link', { name: 'Test it' })).toHaveAttribute('href', agentPath('testRun', 'promo'))
  })

  it('asks for this month from the 1st and shows the schedule on the card', async () => {
    const usageRequests = answerBackend({ agents: [digestAgent, helpdeskAgent], runs: [], waitingChats: [], triggers: [createTrigger({})], usageSummary: monthWithRuns })
    renderHomePage()
    const agentsSection = screen.getByRole('region', { name: 'Agents' })
    const digestCard = await within(agentsSection).findByRole('article', { name: 'Inbox digest' })
    expect(await within(digestCard).findByText('Active · next run tomorrow 07:00')).toBeInTheDocument()
    expect(within(digestCard).getByText(/Weekdays 07:00/)).toBeInTheDocument()
    expect(within(agentsSection).getByRole('article', { name: 'Helpdesk' })).toHaveTextContent('Chatbot')
    expect(usageRequests[0]).toEqual({ fromDate: startOfLocalMonth(new Date()).toISOString() })
  })

  it('shows honest empty states on a fresh install', async () => {
    answerBackend({ agents: [], runs: [], waitingChats: [], triggers: [], usageSummary: emptyMonth, isModelConnected: false })
    renderHomePage()
    expect(await screen.findByText('Nothing needs you · no runs scheduled')).toBeInTheDocument()
    expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument()
    expect(await screen.findByText('Nothing ran this month yet. Numbers show up after your first run')).toBeInTheDocument()
    expect(screen.getByText('No runs yet. Test an agent to see it here')).toBeInTheDocument()
    const checklist = await screen.findByRole('region', { name: /Getting started/ })
    expect(within(checklist).getByText('0 of 5 done')).toBeInTheDocument()
    expect(within(checklist).getByRole('link', { name: 'Connect a model' })).toHaveAttribute('href', routePaths.connections)
    expect(screen.getByRole('link', { name: 'Build one with New agent' })).toHaveAttribute('href', routePaths.newAgent)
  })

  it('previews a long approval message in plain words, with when it paused on its own line', async () => {
    const promotionMessage = 'Send this promotion to HEBAT Business Consulting?\n\nSubject: **Grow faster**\n\nHello team,\nBest regards'
    const longPausedRun: Run = { ...pausedRun, pauseReasons: [{ node_id: 'approve', kind: 'human_input', data: { prompt: promotionMessage } }] }
    answerBackend({ agents: [digestAgent], runs: [longPausedRun, { ...longPausedRun, id: 'run-0' }], waitingChats: [], triggers: [], usageSummary: emptyMonth })
    renderHomePage()
    const needsYou = screen.getByRole('region', { name: /Needs you/ })
    const preview = await within(needsYou).findByText('Send this promotion to HEBAT Business Consulting? Subject: Grow faster Hello team, Best regards')
    expect(preview).toHaveAttribute('title', promotionMessage)
    expect(preview).toHaveClass('line-clamp-2')
    expect(within(needsYou).getByText(/^Today \d\d:\d\d run · paused for your review · 1 more waiting$/)).toBeInTheDocument()
  })

  it('clamps long run results to a plain preview and links to every run', async () => {
    const reportSummary = '## Report\n\n**3 cafes** messaged\n- 1 skipped'
    const succeededRun: Run = { ...pausedRun, status: 'succeeded', pauseReasons: null, outputs: { summary: reportSummary } }
    answerBackend({ agents: [digestAgent], runs: [succeededRun], waitingChats: [], triggers: [], usageSummary: emptyMonth })
    renderHomePage()
    const recentRuns = screen.getByRole('region', { name: 'Recent runs' })
    const resultLink = await within(recentRuns).findByRole('link', { name: 'Report 3 cafes messaged 1 skipped' })
    expect(resultLink).toHaveAttribute('title', reportSummary.trim())
    expect(within(recentRuns).getByRole('link', { name: 'Inbox digest' })).toHaveAttribute('title', 'Inbox digest')
    expect(within(recentRuns).getByRole('link', { name: 'See all runs' })).toHaveAttribute('href', routePaths.runs)
  })
})
