import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentGraph, RequestCheck } from '@/api/agentGraphTypes'
import { resetSampleAgentGraphs } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleTrustedHosts } from '@/api/sampleBackend/trustedHosts'
import { listTrustedLookupHosts } from '@/api/trustedHosts'
import { addFixtureNodes, agentId, renderInspector } from './inspectorTestHarness'

/** What the (mocked) backend says about the HTTP request step `add_to_crm`. */
let crmRequestCheck: RequestCheck | null = null

// The sample backend does not classify requests; the desktop adds `requestCheck` to HTTP steps.
vi.mock('@/api/agentGraph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/agentGraph')>()
  const withRequestCheck = (graph: AgentGraph): AgentGraph => ({
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === 'add_to_crm' ? { ...node, requestCheck: crmRequestCheck } : node)),
  })
  return { ...actual, getAgentGraph: async (...args: Parameters<typeof actual.getAgentGraph>) => withRequestCheck(await actual.getAgentGraph(...args)) }
})

describe('HTTP request inspector: asking first', () => {
  beforeEach(async () => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    resetSampleTrustedHosts()
    await addFixtureNodes()
  })

  it('says a lookup on an untrusted site asks first, and trusts it only on a click', async () => {
    crmRequestCheck = {
      runsWithoutAsking: false,
      reason: 'Asks you first: it sends values to api.weather.com, which you have not trusted for lookups',
      trustableHost: 'api.weather.com',
    }
    const user = userEvent.setup()
    await renderInspector('add_to_crm')

    const status = await screen.findByTestId('request-check')
    expect(status).toHaveTextContent('Asks you first')
    expect(status).toHaveTextContent('which you have not trusted for lookups')
    expect(await listTrustedLookupHosts(agentId)).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Trust api.weather.com for lookups' }))

    await waitFor(async () => expect(await listTrustedLookupHosts(agentId)).toEqual(['api.weather.com']))
    const trustedList = await screen.findByRole('list', { name: 'Trusted hosts' })
    expect(within(trustedList).getByText('api.weather.com')).toBeInTheDocument()
  })

  it('says a trusted lookup runs without asking, with no Trust button', async () => {
    crmRequestCheck = { runsWithoutAsking: true, reason: 'Runs without asking: a read-only lookup on api.weather.com, which you trust for lookups', trustableHost: null }
    await renderInspector('add_to_crm')

    const status = await screen.findByTestId('request-check')
    expect(status).toHaveTextContent('Runs without asking')
    expect(screen.queryByRole('button', { name: /^Trust .* for lookups$/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Read-only requests to these sites run without asking/)).toBeInTheDocument()
  })
})
