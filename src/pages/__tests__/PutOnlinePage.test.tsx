import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleDeploy, setSampleCliStatus, setSampleCompatibility } from '@/api/sampleBackend/deploy'
import { agentRoutePatterns, routePaths, sampleAgentId } from '@/routes'
import { PutOnlinePage } from '../PutOnlinePage'

function CurrentLocation() {
  const location = useLocation()
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>
}

function renderWizard(path: string = routePaths.putOnline) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={agentRoutePatterns.putOnline} element={<PutOnlinePage />} />
        <Route path="*" element={<CurrentLocation />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  resetSampleAgents()
  resetSampleDeploy()
})

async function connectFlyInPopup() {
  await userEvent.click(screen.getByRole('button', { name: 'Connect Fly.io' }))
  const dialog = screen.getByRole('dialog', { name: 'Connect Fly.io' })
  await userEvent.type(within(dialog).getByLabelText('Paste your access key'), 'FlyV1 test_token_0123456789abcdefghij')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
  await within(dialog).findByText('Connected.')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
}

describe('PutOnlinePage', () => {
  it('walks Where → checklist → Provider → Review → progress → done, showing the key once', async () => {
    setSampleCompatibility(sampleAgentId, {
      ready: false,
      items: [
        {
          id: 'model:claude-code-cli',
          level: 'blocker',
          title: 'Claude Code only works on this computer — use OpenAI instead',
          detail: 'Online, it needs an AI service you have connected.',
          fix: { kind: 'switch_model', fromProvider: 'claude-code-cli', toProvider: 'openai', toProviderName: 'OpenAI' },
          fixLabel: 'Use OpenAI (already connected)',
        },
      ],
    })
    renderWizard()
    const stepper = screen.getByRole('list', { name: 'Steps' })
    expect(within(stepper).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: /Online/ })).toBeChecked()
    expect(screen.getByText('Nothing goes online until you review and confirm')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('1 thing to change before this agent can run online')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Use OpenAI (already connected)' }))
    expect(await screen.findByText('Ready to go online')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('heading', { name: 'Where online?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await connectFlyInPopup()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument()
    expect(screen.getByText('Your OpenAI key')).toBeInTheDocument()
    expect(screen.getByText(/Online deploy needs the graphrt tools \(download ~9 MB\)/)).toBeInTheDocument()
    const putOnline = screen.getByRole('button', { name: 'Put it online' })
    expect(putOnline).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Allow download' }))
    await screen.findByText('Saves money')
    await userEvent.selectOptions(screen.getByLabelText('Server location'), 'asia')
    await userEvent.click(screen.getByRole('checkbox', { name: 'I understand Fly.io bills me for this' }))
    await screen.findByRole('button', { name: 'Put it online' })
    expect(screen.getByRole('button', { name: 'Put it online' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Put it online' }))

    expect(await screen.findByRole('heading', { level: 2, name: /is online$/ })).toBeInTheDocument()
    expect(screen.getByText('grk_••••••••••••••••')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Connection details for developers'))
    expect(screen.getByText(/\/v1\/workflows\/agent\/runs$/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show access key once' }))
    expect(screen.getByText('grk_sample_preview_key')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show access key once' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Make a new key' }))
    expect(screen.getByText(/The current one stops working/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Make a new key' }))
    expect(await screen.findByText('grk_sample_new_key_1')).toBeInTheDocument()
    expect(screen.getByText(/Shown once. The old key no longer works/)).toBeInTheDocument()
  })

  it('passes an Advanced server image and refuses one that is not an image name', async () => {
    renderWizard()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await connectFlyInPopup()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Review' })
    await userEvent.click(screen.getByRole('button', { name: 'Allow download' }))
    await screen.findByRole('button', { name: 'Put it online' })
    expect(screen.getByLabelText('Server image')).toHaveValue('')
    await userEvent.type(screen.getByLabelText('Server image'), 'not an image')
    await userEvent.click(screen.getByRole('checkbox', { name: /bills me/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Put it online' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('is not an image name')
  })

  it('says online deploy is not available yet when no graphrt release is pinned', async () => {
    setSampleCliStatus({ status: 'not_available', version: null, downloadSizeBytes: null })
    renderWizard()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await connectFlyInPopup()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/Online deploy is not available yet\. It needs a graphrt release that can put agents online/)).toBeInTheDocument()
    expect(screen.getByText(/matching graphrt server image/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Allow download' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /bills me/ }))
    expect(screen.getByRole('button', { name: 'Put it online' })).toBeDisabled()
  })

  it('labels other providers as coming soon after they connect', async () => {
    renderWizard()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByText('Other providers — for teams that already use them'))
    expect(screen.getAllByText('Coming soon')).toHaveLength(4)
    await userEvent.click(screen.getByRole('button', { name: 'Connect AWS' }))
    const dialog = screen.getByRole('dialog', { name: 'Connect AWS' })
    await userEvent.type(within(dialog).getByLabelText('Access key ID'), 'TESTACCESSKEYID00000')
    await userEvent.type(within(dialog).getByLabelText('Secret access key'), 'test-secret-value-not-real')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Done' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/Putting agents online with AWS is coming soon/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coming soon' })).toBeDisabled()
  })

  it('sends "This computer" back to the builder and "My own server" to its page', async () => {
    renderWizard()
    await userEvent.click(screen.getByText('For IT teams'))
    await userEvent.click(screen.getByRole('radio', { name: /My own server/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText('Current location')).toHaveTextContent(`/agents/${sampleAgentId}/own-server`)
  })
})
