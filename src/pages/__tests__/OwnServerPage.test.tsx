import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { connectOwnServer } from '@/api/deploy'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleDeploy } from '@/api/sampleBackend/deploy'
import { agentPath, agentRoutePatterns, sampleAgentId } from '@/routes'
import { OwnServerPage } from '../OwnServerPage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[agentPath('ownServer', sampleAgentId)]}>
      <Routes>
        <Route path={agentRoutePatterns.ownServer} element={<OwnServerPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  resetSampleAgents()
  resetSampleDeploy()
})

describe('OwnServerPage', () => {
  it('writes the chosen chat page and phone page into the instructions for the IT team', async () => {
    renderPage()
    await userEvent.click(await screen.findByText('Instructions for your IT team'))
    const command = () => document.querySelector('pre')?.textContent ?? ''
    expect(command()).toContain('docker run -d')
    expect(command()).not.toContain('GRAPHRT_CHAT')
    expect(command()).not.toContain('-store:/data')

    await userEvent.click(screen.getByRole('checkbox', { name: /Chat page/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Follow it from your phone/ }))
    await screen.findByText(/These need a graphrt newer than 0\.6\.2 on the server\./)
    expect(command()).toMatch(/-e GRAPHRT_CHAT=\S+ \\/)
    expect(command()).toContain('-e GRAPHRT_CHAT_ACCESS=guests')
    expect(command()).toContain('-e GRAPHRT_MONITOR=1')
    expect(command()).toContain('-e GRAPHRT_STORE=/data')
    expect(command()).toContain('-store:/data')
    expect(screen.getByText(/\/monitor\/$/)).toBeInTheDocument()
    // The storage of a server the IT team runs is theirs: no provider price is named.
    expect(screen.getByText('Uses a storage folder on the server so paired phones stay paired.')).toBeInTheDocument()
  })

  it('says in plain words when a website address cannot be used and keeps the last instructions', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Chat page/ }))
    await userEvent.type(screen.getByLabelText(/Your website/), 'not a site')
    expect(await screen.findByRole('alert')).toHaveTextContent('is not a website address such as https://www.example.com')
    expect(document.querySelector('pre')?.textContent).toContain('docker run -d')
  })

  it('shows what a connected server offers and pairs a phone with it', async () => {
    await connectOwnServer('Office server', 'https://agents.example.com', 'srv_key')
    renderPage()
    const server = (await screen.findByText('Office server')).closest('li') as HTMLElement
    await userEvent.click(within(server).getByRole('button', { name: 'What is on' }))
    expect(await within(server).findByText('Anyone with the link can chat')).toBeInTheDocument()
    await userEvent.click(await within(server).findByRole('button', { name: 'Pair a phone' }))
    await userEvent.type(within(server).getByLabelText('Name of the phone'), 'Front desk')
    await userEvent.click(within(server).getByRole('button', { name: 'Pair' }))
    expect(await within(server).findByRole('img', { name: 'Pairing code' })).toBeInTheDocument()
  })
})
