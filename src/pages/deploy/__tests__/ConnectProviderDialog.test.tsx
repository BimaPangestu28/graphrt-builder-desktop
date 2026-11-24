import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetSampleDeploy } from '@/api/sampleBackend/deploy'
import { dropBrowserFiles } from '@/test/fileDropTestUtils'
import { ConnectProviderDialog } from '../ConnectProviderDialog'
import type { DeployProvider } from '@/api/deployTypes'

function renderDialog(provider: DeployProvider) {
  const onConnected = vi.fn()
  const onClose = vi.fn()
  render(<ConnectProviderDialog provider={provider} onClose={onClose} onConnected={onConnected} />)
  return { onConnected, onClose }
}

beforeEach(() => resetSampleDeploy())

describe('ConnectProviderDialog', () => {
  it('connects Fly.io with a pasted access key and shows it is connected', async () => {
    const { onConnected } = renderDialog('fly')
    expect(screen.getByRole('dialog', { name: 'Connect Fly.io' })).toBeInTheDocument()
    expect(screen.getByText('Sign in or create an account at fly.io')).toBeInTheDocument()
    expect(screen.getByText(/It needs to be an organization token/)).toBeInTheDocument()
    expect(screen.getByText(/fly tokens create org <your-org> --expiry 720h/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Paste your access key'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("doesn't look like a Fly.io access key")
    await userEvent.clear(screen.getByLabelText('Paste your access key'))
    await userEvent.type(screen.getByLabelText('Paste your access key'), 'FlyV1 test_token_0123456789abcdefghij')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Connected.')).toBeInTheDocument()
    expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ provider: 'fly', connected: true }))
  })

  it('takes a dropped Google Cloud key file and refuses other files', async () => {
    const { onConnected } = renderDialog('google_cloud')
    const zone = screen.getByRole('group', { name: /Drop your key file/ })
    dropBrowserFiles(zone, [new File(['x'], 'notes.txt')])
    expect(await screen.findByText(/cannot be added|can't be added|not/i)).toBeInTheDocument()
    dropBrowserFiles(zone, [new File(['{}'], 'acme-agents-graphrt.json')])
    expect(await screen.findByText('acme-agents-graphrt.json')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText(/Service account graphrt@acme-agents/)).toBeInTheDocument()
    expect(onConnected).toHaveBeenCalled()
  })

  it('lets Azure use a client secret instead of a certificate', async () => {
    renderDialog('azure')
    fireEvent.change(screen.getByLabelText('Tenant ID'), { target: { value: '72f988bf-86f1-41af-91ab-2d7cd011db47' } })
    fireEvent.change(screen.getByLabelText('App (client) ID'), { target: { value: '11111111-2222-3333-4444-555555555555' } })
    expect(screen.getByRole('group', { name: /Drop the certificate file/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Paste a client secret instead/ }))
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 's3cret~value' } })
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText(/client secret/)).toBeInTheDocument()
    expect(screen.getByText(/coming soon/)).toBeInTheDocument()
  })

  it('reads the clusters of a dropped kubeconfig before connecting', async () => {
    renderDialog('kubernetes')
    dropBrowserFiles(screen.getByRole('group', { name: /Drop the kubeconfig file/ }), [new File(['apiVersion: v1'], 'kubeconfig.yaml')])
    expect(await screen.findByText('Checked: 2 clusters found')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Cluster to use'), 'prod')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Context prod')).toBeInTheDocument()
  })

  it('closes with Escape', async () => {
    const { onClose } = renderDialog('aws')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
