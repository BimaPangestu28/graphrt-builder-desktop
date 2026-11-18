import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import type { ModelChoice, Trigger } from '@/api/types'
import { routePaths } from '@/routes'
import type { CommandHandler, CommandHandlers } from '@/test/desktopBackend'
import { Sidebar } from './Sidebar'

const fakeBackend = vi.hoisted(() => ({ handlers: {} as CommandHandlers }))
vi.mock('@/api/client', async (importOriginal) => {
  const { createDesktopClient } = await import('@/test/desktopBackend')
  return createDesktopClient(await importOriginal(), fakeBackend)
})

function createTrigger(id: string, agentId: string, enabled: boolean): Trigger {
  return {
    id,
    agentId,
    cronExpression: '0 0 9 * * Mon-Fri',
    timezone: 'Asia/Jakarta',
    enabled,
    missedRunPolicy: 'run_once',
    inputs: {},
    lastFiredAt: null,
    nextFireAt: null,
    createdAt: '2026-11-01T00:00:00Z',
  }
}

const emptyCounts = { all: 0, botAnswering: 0, waitingForYou: 0, youReplying: 0, closed: 0, fromOutreach: 0 }

function answerBackend(getDefaultModel: CommandHandler, triggers: Trigger[]) {
  fakeBackend.handlers = {
    list_agents: () => [],
    count_conversations: () => emptyCounts,
    get_default_model: getDefaultModel,
    list_triggers: () => triggers,
  }
}

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar runnerStatus="Online · OpenAI connected" />
    </MemoryRouter>,
  )
}

const deepSeek: ModelChoice = { provider: 'deepseek', name: 'deepseek-chat' }

describe('Sidebar runner card in the desktop app', () => {
  it('names the default model provider and counts agents with a schedule on', async () => {
    answerBackend(() => deepSeek, [
      createTrigger('morning', 'digest', true),
      createTrigger('evening', 'digest', true),
      createTrigger('weekday', 'leads', true),
      createTrigger('monthly', 'invoices', false),
    ])
    renderSidebar()
    expect(screen.getByText('Checking…')).toBeInTheDocument()
    expect(await screen.findByText('DeepSeek connected · 2 agents scheduled')).toBeInTheDocument()
    expect(screen.queryByText('Online · OpenAI connected')).not.toBeInTheDocument()
  })

  it('uses the singular and leaves out the schedule part when nothing is scheduled', async () => {
    answerBackend(() => deepSeek, [createTrigger('weekday', 'leads', true)])
    const { unmount } = renderSidebar()
    expect(await screen.findByText('DeepSeek connected · 1 agent scheduled')).toBeInTheDocument()
    unmount()

    answerBackend(() => ({ provider: 'openai', name: 'gpt-4o-mini' }), [createTrigger('monthly', 'invoices', false)])
    renderSidebar()
    expect(await screen.findByText('OpenAI connected')).toBeInTheDocument()
  })

  it('links to Connections when no model is connected', async () => {
    answerBackend(() => {
      throw new BackendError('missing_credentials', 'a model provider')
    }, [])
    renderSidebar()
    const addLink = await screen.findByRole('link', { name: 'Add one' })
    expect(addLink).toHaveAttribute('href', routePaths.connections)
    expect(addLink.parentElement).toHaveTextContent('No model connected · Add one')
  })

  it('says so when the runner cannot be checked', async () => {
    answerBackend(() => {
      throw new BackendError('database', 'locked')
    }, [])
    renderSidebar()
    expect(await screen.findByText('Could not check the runner')).toBeInTheDocument()
  })
})
