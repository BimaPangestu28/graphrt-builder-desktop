import type { Conversation } from '@/api/conversationTypes'
import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import type { Problem } from '@/api/problemTypes'
import type { Agent, ProviderStatus, Run, Trigger } from '@/api/types'
import type { UsageSummary } from '@/api/usageSummaryTypes'
import { chooseRunNowInputs, describeAgentCardState, formatNextRunTime } from '@/pages/home-dashboard/agentCardState'
import { deriveGettingStartedSteps, isGettingStartedComplete, type GettingStartedSources } from '@/pages/home-dashboard/gettingStarted'
import { findLatestRunByAgent, formatRelativeTime, runPathFor } from '@/pages/home-dashboard/homeLinks'
import { buildMonthlyNumbers } from '@/pages/home-dashboard/monthlyUsage'
import { buildNeedsYouItems, describePluginGap, type NeedsYouSources } from '@/pages/home-dashboard/needsYou'
import { agentPath, connectionsTabPath, routePaths, runReviewPath } from '@/routes'

const now = new Date('2026-11-18T12:00:00')
const agentNames: Record<string, string> = { promo: 'Cafe promo', digest: 'Inbox digest', helpdesk: 'Helpdesk' }
const agentName = (agentId: string) => agentNames[agentId] ?? agentId
const dnsError = 'connection: iteration item 0 failed: error sending request for url (https://promo.example.com/send): client error (Connect): dns error: failed to lookup address information'

function hoursAgo(hours: number): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString()
}

function buildRun(changes: Partial<Run>): Run {
  return {
    id: 'run-1',
    agentId: 'promo',
    agentVersion: 1,
    trigger: 'manual',
    status: 'succeeded',
    startedAt: hoursAgo(1),
    finishedAt: null,
    outputs: null,
    errorMessage: null,
    errorType: null,
    pauseReasons: null,
    ...changes,
  }
}

function buildAgent(changes: Partial<Agent>): Agent {
  return {
    id: 'promo',
    name: 'Cafe promo',
    kind: 'task',
    description: 'Send a promotion to cafes',
    flowYaml: 'nodes: []',
    status: 'draft',
    currentVersion: 1,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...changes,
  }
}

function buildTrigger(changes: Partial<Trigger>): Trigger {
  return {
    id: 'trigger-1',
    agentId: 'promo',
    cronExpression: '0 0 9 * * Mon',
    timezone: 'Asia/Jakarta',
    enabled: true,
    missedRunPolicy: 'run_once',
    inputs: { city: 'Bandung' },
    lastFiredAt: null,
    nextFireAt: new Date('2026-11-23T09:00:00').toISOString(),
    createdAt: '2026-11-01T00:00:00Z',
    ...changes,
  }
}

function buildRequirement(changes: Partial<PluginRequirement>): PluginRequirement {
  return {
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
    missingConfig: [],
    browserReady: true,
    needsNodeRuntime: true,
    nodeRuntimeReady: true,
    needsSession: false,
    sessionLinked: true,
    ready: true,
    ...changes,
  }
}

function buildProblem(changes: Partial<Problem>): Problem {
  return {
    id: 'problem-1',
    kind: 'missing_credentials',
    title: 'Google Places key is missing',
    detail: 'Add it before the next run',
    needsAttention: true,
    agentId: 'digest',
    agentName: 'Inbox digest',
    runId: null,
    occurredAt: null,
    actions: [{ kind: 'open_builder', label: 'Fix', agentId: 'digest', runId: null }],
    ...changes,
  }
}

const waitingChat = {
  id: 'chat-1',
  agentId: 'helpdesk',
  status: 'waiting_for_you',
  updatedAt: hoursAgo(0.5),
} as Conversation

function buildSources(changes: Partial<NeedsYouSources>): NeedsYouSources {
  return { runs: [], waitingChats: [], problems: [], pluginRequirements: new Map(), connectionReminders: [], agentName, ...changes }
}

describe('Needs you', () => {
  it('lists approvals, chats, failed runs and setup gaps, most urgent first', () => {
    const items = buildNeedsYouItems(
      buildSources({
        runs: [
          buildRun({ id: 'failed-latest', status: 'failed', errorMessage: dnsError }),
          buildRun({ id: 'paused-digest', agentId: 'digest', status: 'paused', pauseReasons: [{ node_id: 'ask', kind: 'human_input', data: { prompt: 'Send it?' } }] }),
        ],
        waitingChats: [waitingChat],
        pluginRequirements: new Map([['promo', [buildRequirement({ ready: false, missingConfig: ['ACCESS_TOKEN'] })]]]),
      }),
      now,
    )
    expect(items?.map((item) => [item.kind, item.actionLabel])).toEqual([
      ['approval', 'Review'],
      ['chat', 'Open Inbox'],
      ['failed_run', 'See what went wrong'],
      ['setup', 'Set up'],
    ])
    expect(items?.map((item) => item.isPrimaryAction)).toEqual([true, false, false, false])
    const failedItem = items?.find((item) => item.kind === 'failed_run')
    expect(failedItem).toMatchObject({
      title: "Cafe promo's last run failed",
      detail: "Could not reach promo.example.com: that address doesn't exist · Today 11:00",
      actionPath: `${routePaths.errorStates}?runId=failed-latest`,
    })
    expect(items?.find((item) => item.kind === 'setup')).toMatchObject({ title: "Cafe promo isn't ready to run", detail: 'WhatsApp Cloud API needs ACCESS_TOKEN', actionPath: agentPath('builder', 'promo') })
  })

  it('only reports a failure when it is the agent\'s latest run', () => {
    const items = buildNeedsYouItems(buildSources({ runs: [buildRun({ id: 'newer' }), buildRun({ id: 'older', status: 'failed', errorMessage: 'boom', startedAt: hoursAgo(30) })] }), now)
    expect(items).toEqual([])
  })

  it('names a failed test run as a failed test', () => {
    const [item] = buildNeedsYouItems(buildSources({ runs: [buildRun({ trigger: 'test', status: 'failed', errorMessage: dnsError })] }), now) ?? []
    expect(item.title).toBe('Cafe promo failed its test')
  })

  it('keeps one row per agent per kind', () => {
    const items = buildNeedsYouItems(
      buildSources({
        runs: [
          buildRun({ id: 'paused-new', status: 'paused', trigger: 'schedule' }),
          buildRun({ id: 'paused-old', status: 'paused', trigger: 'schedule', startedAt: hoursAgo(5) }),
        ],
        problems: [buildProblem({ id: 'p1' }), buildProblem({ id: 'p2', kind: 'plugin_untrusted', title: 'WhatsApp Cloud API is not trusted' })],
        pluginRequirements: new Map([['digest', [buildRequirement({ installed: false, ready: false })]]]),
      }),
      now,
    )
    expect(items?.map((item) => item.kind)).toEqual(['approval', 'setup'])
    expect(items?.[0]).toMatchObject({ actionPath: runReviewPath('paused-new') })
    expect(items?.[0].meta ?? items?.[0].detail).toMatch(/1 more waiting$/)
    expect(items?.[1].detail).toBe("Google Places key is missing · WhatsApp Cloud API is not trusted · WhatsApp Cloud API isn't installed")
  })

  it('sends model-key problems to Connections and broken schedules to the schedule', () => {
    const items = buildNeedsYouItems(
      buildSources({
        problems: [
          buildProblem({ actions: [{ kind: 'open_connections', label: 'Add credit', agentId: null, runId: null }] }),
          buildProblem({ id: 's1', kind: 'schedule_invalid', title: 'The schedule cannot run', actions: [{ kind: 'open_schedule', label: 'Fix', agentId: 'digest', runId: null }] }),
          buildProblem({ id: 's2', kind: 'schedule_failing', needsAttention: false, agentId: 'promo' }),
        ],
      }),
      now,
    )
    expect(items?.map((item) => [item.kind, item.actionPath])).toEqual([
      ['setup', connectionsTabPath('models')],
      ['schedule', agentPath('scheduleAgent', 'digest')],
    ])
  })

  it('is empty only when nothing blocks the user, and null while runs load', () => {
    expect(buildNeedsYouItems(buildSources({ runs: [buildRun({})] }), now)).toEqual([])
    expect(buildNeedsYouItems(buildSources({ runs: null }), now)).toBeNull()
  })

  it('explains why a plugin is not ready', () => {
    expect(describePluginGap(buildRequirement({ installed: false }))).toBe("WhatsApp Cloud API isn't installed")
    expect(describePluginGap(buildRequirement({ trusted: false }))).toBe("WhatsApp Cloud API isn't trusted yet")
    expect(describePluginGap(buildRequirement({ trusted: false, trustNotNeeded: true, browserReady: false }))).toBe('WhatsApp Cloud API needs the browser installed')
    expect(describePluginGap(buildRequirement({ trusted: false, trustNotNeeded: true, nodeRuntimeReady: false }))).toBe('WhatsApp Cloud API needs the plugin runtime installed')
    expect(describePluginGap(buildRequirement({ name: 'whatsapp-web', displayName: 'WhatsApp Web', needsSession: true, sessionLinked: false }))).toBe("WhatsApp Web isn't linked yet")
  })
})

describe('Agent card state', () => {
  it('maps each stage to its chip and next step', () => {
    const draft = describeAgentCardState(buildAgent({}), [], undefined, now)
    expect(draft).toMatchObject({ stage: 'draft', chipLabel: 'Draft · not tested', primaryAction: { label: 'Test it', path: agentPath('testRun', 'promo') } })

    const failedTest = describeAgentCardState(buildAgent({}), [], buildRun({ id: 'r9', status: 'failed', trigger: 'test' }), now)
    expect(failedTest).toMatchObject({ stage: 'test_failed', chipLabel: 'Test failed', chipTone: 'danger', primaryAction: { label: 'See what went wrong', path: `${routePaths.errorStates}?runId=r9` } })

    const tested = describeAgentCardState(buildAgent({ status: 'tested' }), [], buildRun({ trigger: 'test' }), now)
    expect(tested).toMatchObject({ stage: 'tested', chipLabel: 'Tested · not scheduled', primaryAction: { label: 'Schedule it', path: agentPath('scheduleAgent', 'promo') } })

    const active = describeAgentCardState(buildAgent({ status: 'active' }), [buildTrigger({})], buildRun({}), now)
    expect(active).toMatchObject({ stage: 'active', chipLabel: 'Active · next run Mon 09:00', primaryAction: { kind: 'run_now', label: 'Run now' } })

    const failing = describeAgentCardState(buildAgent({ status: 'active' }), [buildTrigger({})], buildRun({ id: 'r2', status: 'failed' }), now)
    expect(failing).toMatchObject({ stage: 'failing', chipLabel: 'Active · last run failed', primaryAction: { label: 'See what went wrong' } })

    const paused = describeAgentCardState(buildAgent({ status: 'paused' }), [buildTrigger({ enabled: false })], buildRun({}), now)
    expect(paused).toMatchObject({ stage: 'paused', chipLabel: 'Paused', primaryAction: { label: 'Resume' } })
    expect(paused.secondaryLinks.map((link) => link.label)).toEqual(['Edit steps', 'Runs'])
  })

  it('sends active chatbots to Inbox instead of running them', () => {
    const chatbot = describeAgentCardState(buildAgent({ kind: 'chatbot', status: 'active' }), [], undefined, now)
    expect(chatbot).toMatchObject({ chipLabel: 'Active · answering chats', primaryAction: { label: 'Open Inbox', path: routePaths.inbox } })
    expect(chatbot.secondaryLinks.map((link) => link.label)).toEqual(['Edit steps', 'Channels', 'Runs'])
    expect(chatbot.secondaryLinks[1].path).toBe(`${routePaths.chatbotSetup}?agentId=promo`)
  })

  it('shows an agent that is online as live, and a tested chatbot as not answering yet', () => {
    const testedChatbot = describeAgentCardState(buildAgent({ kind: 'chatbot', status: 'tested' }), [], undefined, now)
    expect(testedChatbot).toMatchObject({ stage: 'tested', chipLabel: 'Tested · not answering yet' })

    const onlineChatbot = describeAgentCardState(buildAgent({ kind: 'chatbot', status: 'draft' }), [], undefined, now, 'working')
    expect(onlineChatbot).toMatchObject({ stage: 'active', chipLabel: 'Online · answering chats', chipTone: 'ok' })
    const pausedHereOnlineThere = describeAgentCardState(buildAgent({ kind: 'task', status: 'paused' }), [], undefined, now, 'needs_attention')
    expect(pausedHereOnlineThere).toMatchObject({ stage: 'active', chipLabel: 'Online', chipTone: 'amber' })
    const pausedOnline = describeAgentCardState(buildAgent({ kind: 'chatbot', status: 'tested' }), [], undefined, now, 'paused')
    expect(pausedOnline).toMatchObject({ stage: 'tested', chipLabel: 'Tested · not answering yet' })
  })

  it('runs now with the last inputs, else the schedule\'s, else asks', () => {
    expect(chooseRunNowInputs({ city: 'Medan' }, [buildTrigger({})])).toEqual({ city: 'Medan' })
    expect(chooseRunNowInputs(null, [buildTrigger({})])).toEqual({ city: 'Bandung' })
    expect(chooseRunNowInputs(null, [])).toBeNull()
  })

  it('formats the next run briefly', () => {
    expect(formatNextRunTime(new Date('2026-11-18T15:00:00').toISOString(), now)).toBe('today 15:00')
    expect(formatNextRunTime(new Date('2026-11-19T07:00:00').toISOString(), now)).toBe('tomorrow 07:00')
    expect(formatNextRunTime(new Date('2026-12-03T09:00:00').toISOString(), now)).toBe('3 Dec 09:00')
  })
})

describe('Getting started', () => {
  const connected: ProviderStatus[] = [{ provider: 'openai', configured: true, baseUrl: null, localCli: null }]

  function buildGettingStarted(changes: Partial<GettingStartedSources>): GettingStartedSources {
    return { providerStatuses: [], agents: [], runs: [], triggers: [], pluginRequirements: new Map(), agentIdsNeedingSetup: new Set(), ...changes }
  }

  it('starts with nothing done on a fresh install', () => {
    const steps = deriveGettingStartedSteps(buildGettingStarted({ providerStatuses: [{ provider: 'openai', configured: false, baseUrl: null, localCli: null }] }))
    expect(steps.map((step) => [step.id, step.isDone])).toEqual([
      ['model', false],
      ['agent', false],
      ['plugins', false],
      ['test', false],
      ['schedule', false],
    ])
    expect(steps[0].path).toBe(connectionsTabPath('models'))
    expect(steps[1].path).toBe(routePaths.newAgent)
  })

  it('counts Ollama as a connected model only when it is the default', () => {
    const ollamaOnly: ProviderStatus[] = [{ provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434', localCli: null }]
    const notDefault = deriveGettingStartedSteps(buildGettingStarted({ providerStatuses: ollamaOnly, defaultModel: { provider: 'openai', name: 'gpt-4o-mini' } }))
    const asDefault = deriveGettingStartedSteps(buildGettingStarted({ providerStatuses: ollamaOnly, defaultModel: { provider: 'ollama', name: 'llama3.2' } }))
    expect(notDefault[0].isDone).toBe(false)
    expect(asDefault[0].isDone).toBe(true)
  })

  it('counts a turned-on local CLI as a connected model', () => {
    const claudeCodeOn: ProviderStatus[] = [
      {
        provider: 'claude-code-cli',
        configured: true,
        baseUrl: null,
        localCli: { enabled: true, installed: true, version: '2.1.330 (Claude Code)', problem: null, path: null, signIn: 'signed_in', installUrl: 'https://docs.claude.com/en/docs/claude-code/setup' },
      },
    ]
    expect(deriveGettingStartedSteps(buildGettingStarted({ providerStatuses: claudeCodeOn }))[0].isDone).toBe(true)
  })

  it('follows a draft agent whose plugins are not ready', () => {
    const steps = deriveGettingStartedSteps(
      buildGettingStarted({ providerStatuses: connected, agents: [buildAgent({})], pluginRequirements: new Map([['promo', [buildRequirement({ ready: false })]]]) }),
    )
    expect(steps.map((step) => step.isDone)).toEqual([true, true, false, false, false])
    expect(steps[2].path).toBe(agentPath('builder', 'promo'))
    expect(steps[3].path).toBe(agentPath('testRun', 'promo'))
  })

  it('is complete once a tested agent is scheduled', () => {
    const steps = deriveGettingStartedSteps(
      buildGettingStarted({ providerStatuses: connected, agents: [buildAgent({ status: 'tested' })], runs: [buildRun({ trigger: 'test' })], triggers: [buildTrigger({})] }),
    )
    expect(isGettingStartedComplete(steps)).toBe(true)
  })

  it('counts a setup problem as plugins not ready', () => {
    const steps = deriveGettingStartedSteps(buildGettingStarted({ providerStatuses: connected, agents: [buildAgent({})], agentIdsNeedingSetup: new Set(['promo']) }))
    expect(steps.find((step) => step.id === 'plugins')?.isDone).toBe(false)
  })
})

describe('Recent run links and times', () => {
  it('opens each run where it can be acted on', () => {
    expect(runPathFor(buildRun({ id: 'a', status: 'failed' }))).toBe(`${routePaths.errorStates}?runId=a`)
    expect(runPathFor(buildRun({ id: 'b', trigger: 'test', status: 'paused' }))).toBe(agentPath('testRun', 'promo', { runId: 'b' }))
    expect(runPathFor(buildRun({ id: 'c', trigger: 'test' }))).toBe(agentPath('runResult', 'promo', { runId: 'c' }))
    expect(runPathFor(buildRun({ id: 'd', trigger: 'schedule', status: 'paused' }))).toBe(runReviewPath('d'))
    expect(runPathFor(buildRun({ id: 'e' }))).toBe(`${routePaths.runs}?runId=e`)
  })

  it('says how long ago a run started', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 20_000).toISOString(), now)).toBe('just now')
    expect(formatRelativeTime(hoursAgo(0.25), now)).toBe('15 min ago')
    expect(formatRelativeTime(hoursAgo(3), now)).toBe('3 h ago')
    expect(formatRelativeTime(hoursAgo(26), now)).toBe('Yesterday 10:00')
  })

  it('finds each agent\'s latest run', () => {
    const latest = findLatestRunByAgent([buildRun({ id: 'new' }), buildRun({ id: 'old' }), buildRun({ id: 'other', agentId: 'digest' })])
    expect([...latest.values()].map((run) => run.id)).toEqual(['new', 'other'])
  })
})

describe('This month', () => {
  const monthStart = new Date('2026-11-01T00:00:00')
  const usage: UsageSummary = { from: '', runCount: 4, runsWithUsage: 3, usage: { promptTokens: 40_000, completionTokens: 8_300, totalTokens: 48_300 } }

  it('shows succeeded and failed runs, what agents did and AI tokens', () => {
    const runs = [
      buildRun({ outputs: { summary: 'Sent', messages_sent: 11, places_found: 15, aiCostUsd: 0.05 } }),
      buildRun({ outputs: { messages_sent: 1, places_found: 18 } }),
      buildRun({ status: 'failed' }),
      buildRun({ status: 'succeeded', startedAt: new Date('2026-10-30T09:00:00').toISOString(), outputs: { messages_sent: 99 } }),
    ]
    expect(buildMonthlyNumbers(usage, runs, monthStart)).toEqual({
      rows: [
        { label: 'Runs succeeded', value: '2' },
        { label: 'Runs failed', value: '1' },
        { label: 'Messages sent', value: '12' },
        { label: 'Places found', value: '33' },
        { label: 'AI tokens', value: '48K' },
      ],
      isEmpty: false,
    })
  })

  it('is honest when nothing ran', () => {
    const emptyUsage = { ...usage, runCount: 0, runsWithUsage: 0, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    expect(buildMonthlyNumbers(emptyUsage, [], monthStart).isEmpty).toBe(true)
  })
})
