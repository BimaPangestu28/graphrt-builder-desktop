import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { resetSampleBuilder, sampleBuilderBackend, sampleBuildTiming } from '@/api/sampleBackend/builder'
import { appendStoredBuilderMessages } from '@/api/sampleBackend/sampleAgentStore'
import { isSampleWorkflowSecretConfigured, resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import { resetSamplePlugins, samplePluginsBackend, setSampleAgentPluginNeeds, setSampleBrowserRuntimeStatus } from '@/api/sampleBackend/plugins'
import type { BuildProgress, WorkflowSecretStatus } from '@/api/types'
import { agentPath, agentRoutePatterns, builderAskParam, routePaths } from '@/routes'
import { LocationProbe } from '@/test/runTestUtils'
import { BuilderPage } from '../BuilderPage'

function renderBuilderPage(agentId = 'maps-leads', query?: Record<string, string>) {
  return render(
    <MemoryRouter initialEntries={[agentPath('builder', agentId, query)]}>
      <Routes>
        <Route path={agentRoutePatterns.builder} element={<BuilderPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

function getStepsList() {
  return screen.getAllByRole('list').find((list) => list.tagName === 'OL' && within(list).queryByText('Search Google Maps'))!
}

async function sendChange(request: string) {
  fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: request } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('BuilderPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleBuilder()
    resetSampleCredentials()
    resetSamplePlugins()
    sampleBuildTiming.revisionStageDelayMs = 1
  })
  afterEach(() => vi.restoreAllMocks())

  it('loads the agent from the route and shows its steps and what it needs', async () => {
    setSampleAgentPluginNeeds('maps-leads', [])
    renderBuilderPage()
    expect(screen.getByText('Loading agent…')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Maps leads to WhatsApp' })).toBeInTheDocument()
    expect(await screen.findByText('Write a short message')).toBeInTheDocument()
    expect(within(getStepsList()).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('Approval')).toBeInTheDocument()
    expect(screen.getByText('Write a short message').closest('li')).toHaveClass('ml-6')
    expect(screen.getByText('Search Google Maps').closest('li')).not.toHaveClass('ml-6')
    expect(screen.queryByText('Changed just now')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect WhatsApp on this computer' })).toHaveAttribute('href', routePaths.connectWhatsApp)
    expect(await screen.findByText('OpenAI · Keychain')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Test with 1 place/ })).toHaveAttribute('href', routePaths.testRun)
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', routePaths.versionHistory)
    expect(within(screen.getByRole('region', { name: 'Agent' })).getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', routePaths.scheduleAgent)
  })

  it('lets you pick the model the builder uses from the chat header', async () => {
    renderBuilderPage()
    const chat = await screen.findByRole('region', { name: 'Chat' })
    const modelPicker = await within(chat).findByRole('combobox', { name: 'Model the builder uses' })
    expect(modelPicker).toBeEnabled()
    expect(within(modelPicker).getAllByRole('option').length).toBeGreaterThan(0)
  })

  it('builds header links for the agent in the route', async () => {
    renderBuilderPage('invoice-reminders')
    expect(await screen.findByRole('heading', { name: 'Invoice reminders' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', agentPath('versionHistory', 'invoice-reminders'))
  })

  it('sends a change through reviseAgent, highlights changed steps, and undoes it', async () => {
    const reviseAgentSpy = vi.spyOn(sampleBuilderBackend, 'reviseAgent')
    const restoreSpy = vi.spyOn(sampleAgentsBackend, 'restoreAgentVersion')
    renderBuilderPage()
    await screen.findByText('Write a short message')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    await sendChange('Skip places with fewer than 50 reviews')
    expect(screen.getByText('Skip places with fewer than 50 reviews', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByLabelText('Describe a change')).toHaveValue('')
    expect(reviseAgentSpy).toHaveBeenCalledWith('maps-leads', 'Skip places with fewer than 50 reviews', expect.any(Function))
    expect(await screen.findByText('Changed just now')).toBeInTheDocument()
    expect(within(getStepsList()).getAllByRole('listitem')).toHaveLength(7)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: 'Redo' })).toBeInTheDocument()
    expect(restoreSpy).toHaveBeenCalledWith('maps-leads', 7)
    expect(screen.queryByText('Changed just now')).not.toBeInTheDocument()
    expect(within(getStepsList()).getAllByRole('listitem')).toHaveLength(6)

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(await screen.findByText('Changed just now')).toBeInTheDocument()
    expect(restoreSpy).toHaveBeenLastCalledWith('maps-leads', 8)
  })

  it('shows a live builder reply while the change is written, then the explanation and summary', async () => {
    const reviseAgent = sampleBuilderBackend.reviseAgent
    let reportProgress: (progress: BuildProgress) => void = () => {}
    let finishRevision: () => void = () => {}
    vi.spyOn(sampleBuilderBackend, 'reviseAgent').mockImplementation((agentId, instruction, onProgress) => {
      reportProgress = onProgress
      const revisionDone = new Promise<void>((resolve) => (finishRevision = resolve))
      return revisionDone.then(() => reviseAgent(agentId, instruction, () => {}))
    })
    renderBuilderPage()
    await screen.findByText('Write a short message')
    await sendChange('Make it shorter and wait 45 seconds')
    const chat = screen.getByRole('region', { name: 'Chat' })

    act(() => reportProgress({ stage: 'drafting', message: 'Updating the steps' }))
    expect(within(chat).getByText('Updating the steps…')).toBeInTheDocument()
    expect(within(chat).getByText('Updating the steps…').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')

    act(() => reportProgress({ stage: 'drafting', message: 'Updating the steps', draft: { explanation: 'I made the message', stepTitles: ['Ask for keyword'], outputTokens: 98 } }))
    act(() =>
      reportProgress({
        stage: 'drafting',
        message: 'Updating the steps',
        draft: { explanation: 'I made the message shorter.', stepTitles: ['Ask for keyword', 'Search Google Maps'], outputTokens: 1412 },
      }),
    )
    expect(within(chat).getByText('I made the message shorter.')).toBeInTheDocument()
    expect(within(chat).getByText('Writing… 1,412 tokens')).toBeInTheDocument()
    expect(within(within(chat).getByRole('list', { name: 'Steps being written' })).getAllByRole('listitem')).toHaveLength(2)
    // Streamed text stays out of the polite chat region; screen readers keep hearing the stage instead.
    expect(within(chat).getByText('I made the message shorter.').closest('[aria-live]')).toHaveAttribute('aria-live', 'off')
    expect(within(chat).getByText('Writing… 1,412 tokens')).toHaveAttribute('aria-hidden', 'true')
    expect(within(chat).getByText('Updating the steps…')).toHaveClass('sr-only')

    act(() => reportProgress({ stage: 'checking', message: 'Checking the steps again' }))
    expect(within(chat).queryByText(/tokens$/)).not.toBeInTheDocument()
    expect(within(chat).getByText('Checking the steps again…').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
    expect(within(chat).getByText('I made the message shorter.')).toBeInTheDocument()

    act(() => finishRevision())
    const explanation = 'I updated “Write a short message” and “Send WhatsApp” to do what you asked.'
    expect(await within(chat).findByText(explanation)).toBeInTheDocument()
    expect(within(chat).getByText('Changed 2 steps: Write a short message, Send WhatsApp')).toBeInTheDocument()
    expect(within(chat).queryByRole('list', { name: 'Steps being written' })).not.toBeInTheDocument()
    expect(within(chat).getByText(explanation).closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
    expect(within(chat).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('leaves out an empty explanation in the final reply', async () => {
    const reviseAgent = sampleBuilderBackend.reviseAgent
    vi.spyOn(sampleBuilderBackend, 'reviseAgent').mockImplementation(async (agentId, instruction, onProgress) => ({
      ...(await reviseAgent(agentId, instruction, onProgress)),
      explanation: '  ',
    }))
    renderBuilderPage()
    await screen.findByText('Write a short message')
    await sendChange('Make it shorter')
    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(chat).findByText('Changed 1 step: Write a short message')).toBeInTheDocument()
    expect(within(chat).queryByText(/^I updated/)).not.toBeInTheDocument()
  })

  it('shows the stored workflow document in the Source tab', async () => {
    renderBuilderPage()
    await screen.findByRole('heading', { name: 'Maps leads to WhatsApp' })
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    expect(screen.getByRole('tab', { name: 'Source' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getByText(/type: iteration/)).toBeInTheDocument()
  })

  it('explains a failed change in the chat', async () => {
    vi.spyOn(sampleBuilderBackend, 'reviseAgent').mockRejectedValue(new BackendError('model', 'The model is not reachable'))
    renderBuilderPage()
    await screen.findByText('Write a short message')
    await sendChange('Make it friendlier')
    expect(await screen.findByText('Could not change the agent: The model is not reachable')).toBeInTheDocument()
    expect(screen.queryByText('Changed just now')).not.toBeInTheDocument()
  })

  it('stops a change in progress from the chat: nothing is saved and the chat says so', async () => {
    sampleBuildTiming.revisionStageDelayMs = 200
    const firstVisit = renderBuilderPage()
    await screen.findByText('Write a short message')
    const versionBefore = (await sampleAgentsBackend.getAgent('maps-leads')).currentVersion
    await sendChange('Skip places with fewer than 50 reviews')
    const chat = screen.getByRole('region', { name: 'Chat' })
    fireEvent.click(await within(chat).findByRole('button', { name: 'Stop' }))

    expect(await within(chat).findByText('Stopped by you')).toBeInTheDocument()
    expect(within(chat).queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(within(chat).queryByText(/Could not change the agent/)).not.toBeInTheDocument()
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 800)))
    expect((await sampleAgentsBackend.getAgent('maps-leads')).currentVersion, 'the stopped change saved no version').toBe(versionBefore)
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    firstVisit.unmount()

    renderBuilderPage()
    await screen.findByText('Write a short message')
    const reopenedChat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(reopenedChat).findByText('Stopped by you')).toBeInTheDocument()
    expect(within(reopenedChat).getByText('Skip places with fewer than 50 reviews')).toBeInTheDocument()
  })

  it('shows the saved chat again after reopening the builder, without Undo on old changes', async () => {
    const firstVisit = renderBuilderPage()
    await screen.findByText('Write a short message')
    await sendChange('Skip places with fewer than 50 reviews')
    expect(await screen.findByText('Changed just now')).toBeInTheDocument()
    const liveExplanation = within(screen.getByRole('region', { name: 'Chat' })).getByText(/^I added/).textContent
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: 'Redo' })).toBeInTheDocument()
    firstVisit.unmount()

    renderBuilderPage()
    await screen.findByText('Write a short message')
    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(chat).findByText('Skip places with fewer than 50 reviews')).toBeInTheDocument()
    expect(within(chat).getByText(liveExplanation!)).toBeInTheDocument()
    expect(within(chat).getByText('Restored version 7')).toBeInTheDocument()
    expect(within(chat).getAllByText('Skip places with fewer than 50 reviews')).toHaveLength(1)
    expect(within(chat).queryByRole('button', { name: /Undo|Redo/ })).not.toBeInTheDocument()

    await sendChange('Make it shorter')
    expect(await within(chat).findByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(within(chat).getAllByText('Skip places with fewer than 50 reviews')).toHaveLength(1)
    expect(within(chat).getAllByText('Make it shorter')).toHaveLength(1)
  })

  it('shows a saved build explanation and saved failed changes when the builder opens', async () => {
    appendStoredBuilderMessages('maps-leads', [
      { role: 'builder', text: 'Your agent is ready', explanation: 'This agent finds places on Google Maps.', status: 'done', versionBefore: null, versionAfter: 1, changedStepIds: [] },
      { role: 'user', text: 'Make it friendlier', explanation: null, status: 'done', versionBefore: 7, versionAfter: null, changedStepIds: [] },
      { role: 'builder', text: 'model error: the model is not reachable', explanation: null, status: 'failed', versionBefore: 7, versionAfter: null, changedStepIds: [] },
    ])
    renderBuilderPage()
    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(chat).findByText('This agent finds places on Google Maps.')).toBeInTheDocument()
    expect(within(chat).queryByText('Your agent is ready')).not.toBeInTheDocument()
    expect(within(chat).getByText('Make it friendlier')).toBeInTheDocument()
    expect(within(chat).getByText('Could not change the agent: model error: the model is not reachable')).toHaveClass('text-danger')
  })

  it('shows a quiet message for an unknown agent', async () => {
    renderBuilderPage('missing-agent')
    expect(await screen.findByText('Could not load this agent: No agent with id missing-agent')).toBeInTheDocument()
  })

  it('asks for a missing workflow secret inline and saves it to the keychain', async () => {
    const mapsKey: WorkflowSecretStatus = { name: 'MAPS_API_KEY', description: 'Google Places API key', isSecret: true, required: true, configured: false }
    const listSecrets = vi
      .spyOn(sampleCredentialsBackend, 'listWorkflowSecrets')
      .mockResolvedValueOnce([mapsKey])
      .mockResolvedValue([{ ...mapsKey, configured: true }])
    renderBuilderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Add Google Places API key · MAPS_API_KEY' }))
    fireEvent.change(screen.getByLabelText(/Value for/), { target: { value: 'maps-key-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const savedRow = (await screen.findAllByText('Google Places API key · MAPS_API_KEY'))[0].closest('li')!
    expect(await within(savedRow).findByText('Connected')).toBeInTheDocument()
    expect(isSampleWorkflowSecretConfigured('MAPS_API_KEY')).toBe(true)
    expect(listSecrets).toHaveBeenCalledWith('maps-leads')
    expect(screen.queryByDisplayValue('maps-key-123')).not.toBeInTheDocument()
  })

  it('keeps the secret form open with the error when saving fails', async () => {
    vi.spyOn(sampleCredentialsBackend, 'listWorkflowSecrets').mockResolvedValue([
      { name: 'WHATSAPP_TOKEN', description: null, isSecret: true, required: true, configured: false },
    ])
    vi.spyOn(sampleCredentialsBackend, 'setWorkflowSecret').mockRejectedValue(new BackendError('credentials', 'Keychain is locked'))
    renderBuilderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Add WHATSAPP_TOKEN' }))
    fireEvent.change(screen.getByLabelText(/Value for/), { target: { value: 'token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Keychain is locked')
    expect(screen.getByLabelText(/Value for/)).toBeInTheDocument()
  })

  it('opens with the plugin setup card as the first builder message when plugins are not ready', async () => {
    renderBuilderPage()
    const chat = screen.getByRole('region', { name: 'Chat' })
    const setupMessage = await within(chat).findByRole('group', { name: 'This agent needs 2 plugins · 0 ready' })
    expect(within(setupMessage).getByRole('article', { name: 'WhatsApp Cloud API' })).toBeInTheDocument()
    expect(within(setupMessage).getByRole('button', { name: 'Install all & trust' })).toBeInTheDocument()
    expect(within(chat).getByText(/^Your agent has 6 steps/).compareDocumentPosition(setupMessage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // The "Needs" panel lists the same plugins compactly and points to the card.
    const needsRow = screen.getByText('WhatsApp Cloud API plugin').closest('li')!
    expect(needsRow).toHaveTextContent('Not installed')
    fireEvent.click(screen.getByRole('button', { name: 'Set up WhatsApp Cloud API plugin in chat' }))
    expect(setupMessage).toHaveFocus()
  })

  it('keeps the "Needs" panel in sync with what is set up in the chat', async () => {
    setSampleBrowserRuntimeStatus('installed')
    setSampleAgentPluginNeeds('maps-leads', [{ pluginName: 'whatsapp-web', stepId: 'send_whatsapp' }])
    renderBuilderPage()
    const card = await screen.findByRole('article', { name: 'WhatsApp Web' })
    fireEvent.click(within(card).getByRole('button', { name: 'Install & trust WhatsApp Web' }))
    const needsRow = (await screen.findByText('WhatsApp Web plugin')).closest('li')!
    // Installed and trusted is not enough: WhatsApp still has to be linked by QR code.
    const linkButton = await within(needsRow).findByRole('button', { name: 'Link WhatsApp (scan QR code) for WhatsApp Web plugin' })
    expect(within(needsRow).getByText('Not linked')).toBeInTheDocument()
    expect(within(needsRow).queryByText('Ready')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Test with 1 place/ })).not.toBeInTheDocument()

    fireEvent.click(linkButton)
    expect(await within(needsRow).findByText('Ready')).toBeInTheDocument()
    expect(within(needsRow).queryByText('Not linked')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Test with 1 place/ })).toHaveAttribute('href', routePaths.testRun)
  })

  it('recognizes a WhatsApp session linked earlier without a new QR scan', async () => {
    setSampleBrowserRuntimeStatus('installed')
    setSampleAgentPluginNeeds('maps-leads', [{ pluginName: 'whatsapp-web', stepId: 'send_whatsapp' }])
    await samplePluginsBackend.installPlugin('whatsapp-web')
    await samplePluginsBackend.setPluginTrusted('whatsapp-web', true)
    await samplePluginsBackend.runPluginAction('whatsapp-web', 'whatsapp-web.login', {})
    renderBuilderPage()
    const needsRow = (await screen.findByText('WhatsApp Web plugin')).closest('li')!
    expect(await within(needsRow).findByText('Ready')).toBeInTheDocument()
  })

  it('has one Test in the Nodes view: the toolbar one, not the header link', async () => {
    setSampleAgentPluginNeeds('maps-leads', [])
    renderBuilderPage()
    expect(await screen.findByRole('link', { name: /Test with 1 place/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Nodes' }))
    const toolbar = await screen.findByRole('toolbar', { name: 'Nodes' })
    expect(screen.queryByRole('link', { name: /Test with 1 place/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Test with 1 place/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Test$/ })).toEqual([within(toolbar).getByRole('button', { name: /^Test$/ })])
    expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument()
  })

  it('brings the setup card up instead of starting a test while plugins are not ready', async () => {
    renderBuilderPage()
    const setupMessage = await screen.findByRole('group', { name: 'This agent needs 2 plugins · 0 ready' })
    expect(screen.queryByRole('link', { name: /Test with 1 place/ })).not.toBeInTheDocument()
    const testButton = screen.getByRole('button', { name: 'Test with 1 place' })
    expect(testButton).toHaveAccessibleDescription('Set up the plugins this agent needs first')
    fireEvent.click(testButton)
    expect(setupMessage).toHaveFocus()
  })

  it('shows the setup card under the reply of a revision that adds plugins', async () => {
    setSampleAgentPluginNeeds('maps-leads', [])
    renderBuilderPage()
    await screen.findByText('Write a short message')
    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(within(chat).queryByRole('group', { name: /This agent needs/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Test with 1 place/ })).toBeInTheDocument()

    // The revision makes the send step use the personal WhatsApp plugin.
    setSampleAgentPluginNeeds('maps-leads', [{ pluginName: 'whatsapp-web', stepId: 'send_whatsapp' }])
    await sendChange('Send from my personal WhatsApp')
    const setupMessage = await within(chat).findByRole('group', { name: 'This agent needs 1 plugin · 0 ready' })
    const reply = await within(chat).findByText(/^Changed/, { selector: 'p' })
    expect(reply.compareDocumentPosition(setupMessage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(setupMessage).getByRole('note', { name: 'Warning about WhatsApp Web' })).toBeInTheDocument()
    expect(within(chat).getAllByRole('group', { name: /This agent needs/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Test with 1 place' })).toBeInTheDocument()
  })

  it('shows no setup card when a revision leaves the ready plugins alone', async () => {
    setSampleBrowserRuntimeStatus('installed')
    setSampleAgentPluginNeeds('maps-leads', [{ pluginName: 'google-maps-scraper', stepId: 'search_maps' }])
    const listSpy = vi.spyOn(samplePluginsBackend, 'listAgentPluginRequirements')
    renderBuilderPage()
    await screen.findByText('Write a short message')
    await sendChange('Make it shorter')
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(listSpy).toHaveBeenCalledTimes(2)
    expect(within(screen.getByRole('region', { name: 'Chat' })).queryByRole('group', { name: /This agent needs/ })).not.toBeInTheDocument()
  })

  it('prefills the chat box from the ask param without sending it, and drops the param', async () => {
    const reviseAgentSpy = vi.spyOn(sampleBuilderBackend, 'reviseAgent')
    const fixRequest = 'The step "Search Google Maps" (search_maps) failed with: http: 403 Forbidden. Please fix this step.'
    renderBuilderPage('maps-leads', { [builderAskParam]: fixRequest })
    await screen.findByText('Write a short message')

    const prompt = screen.getByLabelText('Describe a change')
    expect(prompt).toHaveValue(fixRequest)
    expect(prompt).toHaveFocus()
    expect(screen.getByLabelText('Current location')).toHaveTextContent(/^\/agents\/maps-leads\/steps$/)
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(reviseAgentSpy).not.toHaveBeenCalled()
    expect(screen.queryByText(fixRequest, { selector: 'div' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(reviseAgentSpy).toHaveBeenCalledWith('maps-leads', fixRequest, expect.any(Function))
  })

  it('leaves the chat box empty without an ask param', async () => {
    renderBuilderPage()
    await screen.findByText('Write a short message')
    expect(screen.getByLabelText('Describe a change')).toHaveValue('')
  })
})
