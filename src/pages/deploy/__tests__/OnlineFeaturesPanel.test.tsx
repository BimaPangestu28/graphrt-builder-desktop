import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { connectOwnServer } from '@/api/deploy'
import { noOnlineFeatures, type OnlineFeatures } from '@/api/deployTypes'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleDeploy, seedSampleDeployment, setSampleServerFeatures } from '@/api/sampleBackend/deploy'
import { sampleAgentId } from '@/routes'
import { OnlineFeaturesPanel } from '../OnlineFeaturesPanel'

const everything: OnlineFeatures = { chat: true, chatAudience: 'guests', embedSite: 'https://www.toko-kue.example', phone: true, notifications: true, notifyEmail: 'ana@example.com', answerWhenTimeRunsOut: true, whatsapp: false, teams: false }

function renderAgentPanel(features: OnlineFeatures) {
  seedSampleDeployment(sampleAgentId, {}, false, features)
  render(
    <MemoryRouter>
      <OnlineFeaturesPanel target={{ kind: 'agent', agentId: sampleAgentId }} chosen={features} changeTo="/change" />
    </MemoryRouter>,
  )
}

let copiedTexts: string[] = []

beforeEach(() => {
  resetSampleAgents()
  resetSampleDeploy()
  copiedTexts = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => Promise.resolve(void copiedTexts.push(text)) } })
})

describe('OnlineFeaturesPanel', () => {
  it('says plainly that everything is off, with a way to change it', async () => {
    renderAgentPanel(noOnlineFeatures)
    expect(await screen.findByText('Nobody can chat with it in a browser')).toBeInTheDocument()
    expect(screen.getByText('Not on your phone')).toBeInTheDocument()
    expect(screen.getByText('Requests wait until someone answers')).toBeInTheDocument()
    expect(screen.getAllByText('Off')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/change')
    expect(screen.queryByRole('button', { name: 'Pair a phone' })).not.toBeInTheDocument()
  })

  it('gives the link to share and the one line for a website, each with a copy button', async () => {
    renderAgentPanel(everything)
    expect(await screen.findByText('Anyone with the link can chat')).toBeInTheDocument()
    expect(screen.getAllByText('On')).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await userEvent.click(screen.getByRole('button', { name: 'Copy line' }))
    expect(copiedTexts[0]).toMatch(/^https:\/\/.+\.fly\.dev\/chat\/agent$/)
    expect(copiedTexts[1]).toMatch(/^<script src="https:\/\/.+\.fly\.dev\/chat\/embed\.js" data-workflow="agent" async><\/script>$/)
    expect(screen.getByText('The chat bubble works on https://www.toko-kue.example')).toBeInTheDocument()
    expect(screen.getByText('Requests answer themselves when their time runs out')).toBeInTheDocument()
  })

  it('shows a pairing code only after pairing, hides it on request and shows it again on request', async () => {
    renderAgentPanel(everything)
    expect(await screen.findByText('No phone is paired yet.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Pairing code' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Pair a phone' }))
    expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Name of the phone'), "Ana's phone")
    await userEvent.click(screen.getByRole('button', { name: 'Pair' }))

    expect(await screen.findByRole('img', { name: 'Pairing code' })).toBeInTheDocument()
    expect(screen.getByText("Scan with Ana's phone")).toBeInTheDocument()
    expect(screen.getByText("This code is that phone's key. Do not share a picture of it.")).toBeInTheDocument()
    // The link holds the key: it is drawn as a code and never written on the screen.
    expect(document.body.textContent).not.toContain('#pair=')

    await userEvent.click(screen.getByRole('button', { name: 'Hide code' }))
    expect(screen.queryByRole('img', { name: 'Pairing code' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show code' }))
    expect(await screen.findByRole('img', { name: 'Pairing code' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy link instead' }))
    expect(copiedTexts.at(-1)).toContain('/monitor/#pair=')
  })

  it('removes a phone only after a confirmation that says it stops working at once', async () => {
    renderAgentPanel(everything)
    await userEvent.click(await screen.findByRole('button', { name: 'Pair a phone' }))
    await userEvent.type(screen.getByLabelText('Name of the phone'), 'Wall display')
    await userEvent.click(screen.getByRole('button', { name: 'Pair' }))
    await screen.findByRole('img', { name: 'Pairing code' })

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const confirmation = screen.getByRole('alertdialog', { name: 'Remove phone' })
    expect(confirmation).toHaveTextContent('Remove Wall display? It stops working at once.')
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Keep it' }))
    expect(screen.getByText('Wall display')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Remove phone' })).getByRole('button', { name: 'Remove phone' }))
    expect(await screen.findByText('No phone is paired yet.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Pairing code' })).not.toBeInTheDocument()
  })

  it('shows what a connected server offers, without a Change link', async () => {
    const server = await connectOwnServer('Office server', 'https://agents.example.com', 'srv_key')
    setSampleServerFeatures(server.server.id, { ...noOnlineFeatures, chat: true, chatAudience: 'key' })
    render(
      <MemoryRouter>
        <OnlineFeaturesPanel target={{ kind: 'server', serverId: server.server.id }} />
      </MemoryRouter>,
    )
    expect(await screen.findByText('People need the access key to chat')).toBeInTheDocument()
    expect(screen.getByText('Not on your phone')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Change' })).not.toBeInTheDocument()
  })

  it('says so when the online agent cannot be asked, and offers to try again', async () => {
    render(
      <MemoryRouter>
        <OnlineFeaturesPanel target={{ kind: 'agent', agentId: 'no-such-agent' }} />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('status')).toHaveTextContent('We could not ask the online agent what is on.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
