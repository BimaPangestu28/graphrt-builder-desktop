import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { resetSampleAgentGraphs } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { FAIL_BRANCH_HANDLE } from '@/lib/agentGraphRules'
import { addFixtureNodes, currentNode, harness, renderInspector } from './inspectorTestHarness'

function commitNumber(label: string, value: string) {
  const input = screen.getByRole('spinbutton', { name: label })
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

function openSection(name: string) {
  const toggle = screen.getByRole('button', { name })
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
}

describe('NodeInspector', () => {
  beforeEach(async () => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    await addFixtureNodes()
  })

  it('shows the header and renames the step through the controller', async () => {
    await renderInspector('send_whatsapp')
    expect(screen.getByText('WhatsApp Web · Send WhatsApp message')).toBeInTheDocument()
    const title = screen.getByRole('textbox', { name: 'Node title' })
    fireEvent.change(title, { target: { value: 'Send the promotion' } })
    fireEvent.blur(title)
    expect(currentNode('send_whatsapp').title).toBe('Send the promotion')
    expect(harness.controller?.pendingDescriptions.at(-1)).toContain('renamed to “Send the promotion”')
    expect(harness.controller?.canUndo).toBe(true)
  })

  it('builds the schema form for a plugin action and writes its fields', async () => {
    await renderInspector('search_maps')
    expect(screen.getByRole('textbox', { name: 'Query' })).toBeInTheDocument()
    commitNumber('Max results', '35')
    expect(currentNode('search_maps').config.max_results).toBe(35)
    expect(currentNode('search_maps').config.query).toBe('{{#ask_input.keyword#}} in {{#ask_input.city#}}')
  })

  it('changes a plugin action, keeps unused values aside and undoes the change', async () => {
    await renderInspector('send_whatsapp')
    fireEvent.click(screen.getByRole('button', { name: /Change action/ }))
    fireEvent.click(screen.getByRole('option', { name: /WhatsApp status/ }))
    expect(currentNode('send_whatsapp').kind).toBe('whatsapp-web.get_status')
    expect(currentNode('send_whatsapp').config).toMatchObject({ phone: '{{#for_each_place.item.phone#}}', text: '{{#write_message.text#}}' })
    const notUsed = screen.getByRole('group', { name: 'Not used by WhatsApp status' })
    expect(within(notUsed).getByText('Phone')).toBeInTheDocument()

    fireEvent.click(within(notUsed).getByRole('button', { name: 'Remove text' }))
    expect(currentNode('send_whatsapp').config).not.toHaveProperty('text')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(currentNode('send_whatsapp').kind).toBe('whatsapp-web.send_message')
    expect(currentNode('send_whatsapp').config).toHaveProperty('text')
  })

  it('adds the fail-branch port with “Go to the error path” and marks its arrow unused when switched off', async () => {
    await renderInspector('write_message')
    openSection('When this step fails')
    fireEvent.click(screen.getByRole('radio', { name: /Go to the error path/ }))
    expect(currentNode('write_message').onError.strategy).toBe('fail-branch')
    expect(currentNode('write_message').ports.outputs.map((port) => port.id)).toContain(FAIL_BRANCH_HANDLE)

    harness.controller?.addEdge({ source: 'write_message', sourceHandle: FAIL_BRANCH_HANDLE, target: 'send_whatsapp' })
    await waitFor(() => expect(harness.controller?.graph?.edges.some((edge) => edge.sourceHandle === FAIL_BRANCH_HANDLE)).toBe(true))

    fireEvent.click(screen.getByRole('radio', { name: /Stop the run/ }))
    expect(currentNode('write_message').ports.outputs.map((port) => port.id)).not.toContain(FAIL_BRANCH_HANDLE)
    expect(harness.controller?.graph?.edges.find((edge) => edge.sourceHandle === FAIL_BRANCH_HANDLE)?.unused).toBe(true)
  })

  it('writes retry, time limit and fallback values', async () => {
    await renderInspector('write_message')
    openSection('When this step fails')
    commitNumber('Retries', '2')
    commitNumber('Wait before the first retry', '2')
    commitNumber('Multiply the wait by', '2')
    commitNumber('Time limit', '30')
    expect(currentNode('write_message').retry).toEqual({ maxRetries: 2, intervalMs: 2000, backoff: 2 })
    expect(currentNode('write_message').timeoutMs).toBe(30000)
    expect(screen.getByText(/Waits 2 s, then 4 s/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /Continue with fallback values/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a value' }))
    expect(currentNode('write_message').onError).toEqual({ strategy: 'default-value', values: { text: null } })
  })

  it('lists upstream outputs in the variable picker and inserts the reference', async () => {
    await renderInspector('write_message')
    fireEvent.click(screen.getAllByRole('button', { name: /Insert value/ })[0])
    const picker = screen.getByRole('listbox', { name: 'Insert a value from an earlier step' })
    const groups = within(picker).getAllByRole('group').map((group) => group.getAttribute('aria-label'))
    expect(groups).toEqual(expect.arrayContaining(['For each place · item', 'Search Google Maps', 'Start', 'This run']))
    expect(groups).not.toContain('Send WhatsApp')
    fireEvent.click(within(within(picker).getByRole('group', { name: 'Search Google Maps' })).getByRole('option', { name: /results/ }))
    const prompt = currentNode('write_message').config.prompt_template as Array<{ text: string }>
    expect(prompt[0].text.endsWith('{{#search_maps.results#}}')).toBe(true)
  })

  it('maps Ask a model controls to model params and reasoning_format', async () => {
    await renderInspector('write_message')
    commitNumber('Temperature', '0.4')
    expect(currentNode('write_message').config.model).toEqual({ provider: 'openai', name: 'gpt-4o-mini', completion_params: { temperature: 0.4 } })
    openSection('Thinking')
    fireEvent.click(screen.getByRole('radio', { name: /Show it separately/ }))
    expect(currentNode('write_message').config.reasoning_format).toBe('separated')
  })

  it('adds if-else cases as ports and removes a case with its arrow after asking', async () => {
    await renderInspector('has_phone')
    fireEvent.click(screen.getByRole('button', { name: 'Add a case' }))
    expect(currentNode('has_phone').ports.outputs.map((port) => port.id)).toEqual(['case_1', 'case_2', 'false'])

    fireEvent.click(screen.getByRole('button', { name: 'Remove Case 1' }))
    const question = screen.getByRole('alertdialog', { name: 'Remove Case 1?' })
    fireEvent.click(within(question).getByRole('button', { name: 'Remove' }))
    expect(currentNode('has_phone').ports.outputs.map((port) => port.id)).toEqual(['case_2', 'false'])
    expect(harness.controller?.graph?.edges.some((edge) => edge.source === 'has_phone')).toBe(false)
  })

  it('maps For each settings and requires one at a time when the body asks for approval', async () => {
    await renderInspector('for_each_place')
    expect(screen.getByRole('radio', { name: /Several at once/ })).toBeDisabled()
    expect(screen.getByText('Required here: this loop asks you before continuing')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Drop its result/ }))
    expect(currentNode('for_each_place').config.error_handle_mode).toBe('remove-abnormal-output')
  })

  it('sets the approval time limit (timeout_ms) and the on-timeout answer', async () => {
    await renderInspector('approve_message')
    openSection('Time limit')
    commitNumber('Hours', '2')
    expect(currentNode('approve_message').timeoutMs).toBe(7_200_000)
    fireEvent.change(screen.getByRole('combobox', { name: 'When it expires' }), { target: { value: 'action:skip' } })
    expect(currentNode('approve_message').config.on_timeout).toEqual({ action: 'skip' })
  })

  it('maps HTTP request controls to method, headers and body', async () => {
    await renderInspector('add_to_crm')
    fireEvent.change(screen.getByRole('combobox', { name: 'Method' }), { target: { value: 'post' } })
    expect(currentNode('add_to_crm').config.method).toBe('post')
    const headerValue = screen.getByRole('textbox', { name: 'Headers 1 value' })
    expect(headerValue).toHaveValue('application/json')
    fireEvent.change(headerValue, { target: { value: 'text/plain' } })
    fireEvent.blur(headerValue)
    expect(currentNode('add_to_crm').config.headers).toEqual([{ key: 'Accept', value: 'text/plain' }])
    fireEvent.change(screen.getByRole('combobox', { name: 'Body type' }), { target: { value: 'json' } })
    expect(currentNode('add_to_crm').config.body).toEqual({ type: 'json', data: '' })
  })

  it('maps Knowledge retrieval results and offers no re-ranking', async () => {
    await renderInspector('look_up_menu')
    commitNumber('Top results', '8')
    expect(currentNode('look_up_menu').config.multiple_retrieval_config).toEqual({ top_k: 8 })
    expect(screen.queryByText(/rerank model/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Re-ranking isn’t offered/)).toBeInTheDocument()
  })

  it('maps Remember a value operations', async () => {
    await renderInspector('count_replies')
    fireEvent.change(screen.getByRole('combobox', { name: 'Change 1 operation' }), { target: { value: 'append' } })
    expect((currentNode('count_replies').config.items as Array<{ operation: string }>)[0].operation).toBe('append')
  })

  it('marks a Run an agent tool as Ask me first in require_approval', async () => {
    await renderInspector('lead_agent')
    const askFirst = await screen.findByRole('checkbox', { name: 'Ask me first before whatsapp-web/send_message' })
    fireEvent.click(askFirst)
    expect(currentNode('lead_agent').config.require_approval).toEqual(['whatsapp-web/send_message'])
  })

  it('duplicates and deletes the step', async () => {
    await renderInspector('write_message')
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    const copy = harness.controller?.graph?.nodes.find((node) => node.id === 'write_message_2')
    expect(copy).toMatchObject({ parent: 'for_each_place', title: 'Write a short message (copy)' })
    expect(copy?.config).toEqual(currentNode('write_message').config)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(harness.controller?.graph?.nodes.some((node) => node.id === 'write_message')).toBe(false)
  })
})
