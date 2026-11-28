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

  it('signs in to Google Cloud with Google instead of a form', async () => {
    const { onConnected } = renderDialog('google_cloud')
    expect(screen.getByRole('dialog', { name: 'Sign in with Google' })).toBeInTheDocument()
    expect(screen.getByText(/Google hasn’t verified this app/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    expect(await screen.findByText('Signed in as ana@acme.com')).toBeInTheDocument()
    expect(screen.getByText(/You can now pick it/i)).toBeInTheDocument()
    expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google_cloud', connected: true, canDeploy: true }))
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
