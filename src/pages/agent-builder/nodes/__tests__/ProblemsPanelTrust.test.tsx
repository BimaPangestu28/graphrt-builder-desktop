import { render, renderHook, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentGraph, GraphNode, GraphProblem } from '@/api/agentGraphTypes'
import { resetSampleTrustedHosts } from '@/api/sampleBackend/trustedHosts'
import { listTrustedLookupHosts } from '@/api/trustedHosts'
import { ProblemsPanel } from '../ProblemsPanel'
import { useTrustHostAction } from '../problems/useTrustHostAction'
import type { GraphValidation } from '../problems/useGraphValidation'
import type { AgentGraphController } from '../useAgentGraph'

const agentId = 'weather-bot'

const lookupNode: GraphNode = {
  id: 'lookup',
  kind: 'http-request',
  title: 'Look up the weather',
  displayTitle: 'Look up the weather',
  detail: 'api.open-meteo.com',
  parent: null,
  config: { method: 'get', url: 'https://api.open-meteo.com/v1/forecast?q={{#start.note#}}' },
  onError: { strategy: 'fail', values: {} },
  retry: { maxRetries: 0, intervalMs: 1000, backoff: 2 },
  timeoutMs: null,
  ports: { inputs: [], outputs: [] },
  container: false,
  hidden: false,
  needsApproval: false,
  sendsData: true,
  plugin: null,
}

const graph: AgentGraph = { agentId, version: 1, latestVersion: 1, name: null, nodes: [lookupNode], edges: [], inputs: [], env: [], problems: [] }

const untrustedLookup: GraphProblem = {
  severity: 'error',
  code: 'send_without_approval',
  message: 'Look up the weather sends values to api.open-meteo.com without asking you first: Ask before sending, or trust api.open-meteo.com for read-only lookups',
  nodeId: 'lookup',
  edgeId: null,
  trustHost: 'api.open-meteo.com',
}

describe('Trust action on a problem', () => {
  beforeEach(() => resetSampleTrustedHosts())

  it('offers Trust <host> on a lookup that only needs its host trusted', async () => {
    const user = userEvent.setup()
    const onTrustHost = vi.fn()
    render(<ProblemsPanel problems={[untrustedLookup]} graph={graph} onSelectNode={() => undefined} onTrustHost={onTrustHost} />)

    expect(screen.getByText(/Ask before sending, or trust api.open-meteo.com for read-only lookups/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Trust api.open-meteo.com' }))
    expect(onTrustHost).toHaveBeenCalledWith('api.open-meteo.com')
  })

  it('offers no Trust action for other sends', () => {
    const write: GraphProblem = { ...untrustedLookup, message: 'Post the note sends data without asking you first', trustHost: null }
    render(<ProblemsPanel problems={[write]} graph={graph} onSelectNode={() => undefined} onTrustHost={() => undefined} />)
    expect(screen.queryByRole('button', { name: /^Trust / })).not.toBeInTheDocument()
  })

  it('trusts the host and checks the graph again (reloads it without local edits)', async () => {
    const reload = vi.fn(async () => undefined)
    const validate = vi.fn(async () => [])
    const controller = { isDirty: false, reload } as unknown as AgentGraphController
    const validation = { validate } as unknown as GraphValidation
    const { result } = renderHook(() => useTrustHostAction(agentId, controller, validation))

    await act(() => result.current.trustHost('api.open-meteo.com'))

    expect(await listTrustedLookupHosts(agentId)).toEqual(['api.open-meteo.com'])
    expect(reload).toHaveBeenCalledTimes(1)
    expect(validate).not.toHaveBeenCalled()
    expect(result.current.trustError).toBeNull()
  })

  it('says why trusting failed', async () => {
    const controller = { isDirty: true, reload: vi.fn() } as unknown as AgentGraphController
    const validation = { validate: vi.fn(async () => []) } as unknown as GraphValidation
    const { result } = renderHook(() => useTrustHostAction(agentId, controller, validation))

    await act(() => result.current.trustHost('https://evil.org'))

    expect(result.current.trustError).toMatch(/^Could not trust https:\/\/evil.org: Enter only the site name/)
    expect(await listTrustedLookupHosts(agentId)).toEqual([])
  })
})
