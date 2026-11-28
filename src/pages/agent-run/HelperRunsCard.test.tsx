import { render, screen, within } from '@testing-library/react'
import { HelperRunsCard } from './HelperRunsCard'
import type { HelperRun } from './runAbilityEvents'

const helper = (changes: Partial<HelperRun>): HelperRun => ({ frame: 'assistant.a1[0]', agentId: 'a1', stepId: 'assistant', index: 0, status: 'finished', stepCount: 2, children: [], ...changes })

describe('HelperRunsCard', () => {
  it('lists each request for help with its status and the helpers it asked in turn', () => {
    const nested = helper({ frame: 'assistant.a1[0]/checker.a2[0]', agentId: 'a2', status: 'stopped', stepCount: 0 })
    render(<HelperRunsCard helpers={[helper({ children: [nested] }), helper({ frame: 'assistant.zz[1]', agentId: 'zz', index: 1, status: 'failed' })]} nameOf={(agentId) => (agentId === 'a1' ? 'Stock checker' : agentId === 'a2' ? 'Price list' : agentId)} />)
    const card = screen.getByRole('region', { name: 'Help from other agents' })
    const items = within(card).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Asked Stock checker')
    expect(items[0]).toHaveTextContent('2 steps')
    expect(items[0]).toHaveTextContent('Done')
    expect(items[1]).toHaveTextContent('Asked Price list')
    expect(items[1]).toHaveTextContent('Stopped')
    // An id the app cannot name is not shown as a name.
    expect(items[2]).toHaveTextContent('Asked Another agent')
    expect(items[2]).toHaveTextContent('Failed')
  })

  it('shows nothing when the run asked nobody', () => {
    const { container } = render(<HelperRunsCard helpers={[]} nameOf={(agentId) => agentId} />)
    expect(container).toBeEmptyDOMElement()
  })
})
