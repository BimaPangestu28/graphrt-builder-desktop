import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetSampleTrustedHosts } from '@/api/sampleBackend/trustedHosts'
import { listTrustedLookupHosts } from '@/api/trustedHosts'
import { findTrustProposals } from '@/lib/trustProposals'
import { BuilderExplanation } from './BuilderExplanation'

const agentId = 'weather-bot'

describe('findTrustProposals', () => {
  it('reads every "Trust <host> for lookups" once, lower-cased', () => {
    expect(findTrustProposals('Added a lookup. Trust `API.open-meteo.com` for lookups. Also trust *.maps.org for lookups, trust api.open-meteo.com for lookups')).toEqual([
      'api.open-meteo.com',
      '*.maps.org',
    ])
  })

  it('ignores text that is not a host', () => {
    expect(findTrustProposals('I trust you for lookups')).toEqual([])
    expect(findTrustProposals('Trust https://evil.org for lookups')).toEqual([])
    expect(findTrustProposals('Nothing to trust here')).toEqual([])
  })
})

describe('BuilderExplanation', () => {
  beforeEach(() => resetSampleTrustedHosts())

  it('turns a trust proposal into a button that trusts only when clicked', async () => {
    const user = userEvent.setup()
    render(<BuilderExplanation agentId={agentId} text="I look up the weather. Trust api.open-meteo.com for lookups" />)

    const trustButton = await screen.findByRole('button', { name: 'Trust api.open-meteo.com for lookups' })
    expect(await listTrustedLookupHosts(agentId)).toEqual([])

    await user.click(trustButton)

    expect(await screen.findByText('api.open-meteo.com is trusted for lookups')).toBeInTheDocument()
    expect(await listTrustedLookupHosts(agentId)).toEqual(['api.open-meteo.com'])
  })

  it('shows plain text without proposals or without an agent', () => {
    const { rerender } = render(<BuilderExplanation agentId={agentId} text="I made the messages shorter." />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<BuilderExplanation agentId={null} text="Trust api.open-meteo.com for lookups" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
