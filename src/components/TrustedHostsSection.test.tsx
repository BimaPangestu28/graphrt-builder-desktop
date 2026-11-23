import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetSampleTrustedHosts } from '@/api/sampleBackend/trustedHosts'
import { addTrustedLookupHost, listTrustedLookupHosts } from '@/api/trustedHosts'
import { TrustedHostsSection } from './TrustedHostsSection'

const agentId = 'weather-bot'

describe('TrustedHostsSection', () => {
  beforeEach(() => resetSampleTrustedHosts())

  it('explains what trusting does and starts empty', async () => {
    render(<TrustedHostsSection agentId={agentId} />)
    expect(screen.getByRole('heading', { name: 'Trusted hosts for lookups' })).toBeInTheDocument()
    expect(screen.getByText('Read-only requests to these sites run without asking. Anything that changes data still asks you first.')).toBeInTheDocument()
    expect(await screen.findByText('No trusted hosts yet')).toBeInTheDocument()
  })

  it('adds a host the user types, normalized, and removes it', async () => {
    const user = userEvent.setup()
    render(<TrustedHostsSection agentId={agentId} />)
    await screen.findByText('No trusted hosts yet')

    await user.type(screen.getByRole('textbox', { name: 'Site to trust' }), ' API.Weather.com ')
    await user.click(screen.getByRole('button', { name: 'Trust' }))

    const list = await screen.findByRole('list', { name: 'Trusted hosts' })
    expect(within(list).getByText('api.weather.com')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Site to trust' })).toHaveValue('')
    expect(await listTrustedLookupHosts(agentId)).toEqual(['api.weather.com'])

    await user.click(screen.getByRole('button', { name: 'Stop trusting api.weather.com' }))
    expect(await screen.findByText('No trusted hosts yet')).toBeInTheDocument()
    expect(await listTrustedLookupHosts(agentId)).toEqual([])
  })

  it('shows why a host cannot be trusted and keeps what was typed', async () => {
    const user = userEvent.setup()
    render(<TrustedHostsSection agentId={agentId} />)
    await screen.findByText('No trusted hosts yet')

    await user.type(screen.getByRole('textbox', { name: 'Site to trust' }), 'https://evil.org/x')
    await user.click(screen.getByRole('button', { name: 'Trust' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('without http:// or https://')
    expect(screen.getByRole('textbox', { name: 'Site to trust' })).toHaveValue('https://evil.org/x')
    expect(await listTrustedLookupHosts(agentId)).toEqual([])
  })

  it('shows hosts trusted elsewhere (a problem’s Trust action) right away', async () => {
    render(<TrustedHostsSection agentId={agentId} />)
    await screen.findByText('No trusted hosts yet')
    await addTrustedLookupHost(agentId, '*.maps.org')
    await waitFor(() => expect(screen.getByText('*.maps.org')).toBeInTheDocument())
  })
})
