import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getAgentGraph, getToolInputSchemas, saveAgentGraph } from '@/api/agentGraph'
import { toGraphEdit } from '../../graphEdits'
import { listAllWorkflowSecrets } from '@/api/credentials'
import { resetSampleAgentGraphs } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleCredentials } from '@/api/sampleBackend/credentials'
import { resetSampleMcpServers } from '@/api/sampleBackend/mcpServers'
import { resetSamplePlugins } from '@/api/sampleBackend/plugins'
import { toSchemaToolParameter } from '../panels/ConnectPanels'
import { withSecretDeclared } from '../SecretPicker'
import { addFixtureNodes, agentId, currentNode, harness, renderInspector } from './inspectorTestHarness'

/** Adds a "Use a tool" step calling the sample filesystem server's read_file. */
async function addToolNode() {
  const graph = await getAgentGraph(agentId)
  const toolNode = { id: 'read_notes', kind: 'tool', title: 'Read the notes', parent: null, config: { provider_id: 'files', tool_name: 'read_file' }, onError: { strategy: 'fail' as const, values: {} }, retry: { maxRetries: 0, intervalMs: 1000, backoff: 2 }, timeoutMs: null }
  const edit = toGraphEdit(graph)
  await saveAgentGraph(agentId, graph.version, { ...edit, nodes: [...edit.nodes, toolNode], description: 'tool fixture' })
}

async function typeInto(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.click(field)
  await user.keyboard(text)
  await user.tab()
}

describe('Use a tool inputs from tool schemas', () => {
  beforeEach(async () => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    resetSampleMcpServers()
    resetSamplePlugins()
    await addFixtureNodes()
    await addToolNode()
  })

  it('lists plugin and MCP tool schemas, with unknown ones as null', async () => {
    const schemas = await getToolInputSchemas()
    expect(schemas.find((schema) => schema.name === 'search_google_maps')).toMatchObject({ provider: 'google-maps-scraper', source: 'plugin' })
    expect(schemas.find((schema) => schema.name === 'read_file')?.inputSchema).toMatchObject({ required: ['path'] })
    expect(schemas.find((schema) => schema.name === 'list_directory')?.inputSchema).toBeNull()
  })

  it('renders the tool inputs as a form from its schema and types fixed values', async () => {
    const user = userEvent.setup()
    await renderInspector('read_notes')
    const path = await screen.findByRole('textbox', { name: 'Input path' })
    expect(screen.getByText(/string · File to read/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove input path' }), 'schema inputs cannot be removed').not.toBeInTheDocument()
    await typeInto(user, path, 'notes.txt')
    expect(currentNode('read_notes').config.tool_parameters).toEqual({ path: { type: 'constant', value: 'notes.txt' } })

    fireEvent.click(within(screen.getByRole('group', { name: 'MCP servers' })).getByRole('radio', { name: /search_files/ }))
    const maxResults = await screen.findByRole('textbox', { name: 'Input max_results' })
    expect(screen.getByRole('textbox', { name: 'Input pattern' })).toBeInTheDocument()
    await typeInto(user, maxResults, '5')
    expect((currentNode('read_notes').config.tool_parameters as Record<string, unknown>).max_results).toEqual({ type: 'constant', value: 5 })
  })

  it('falls back to inputs typed by name when the schema is unknown', async () => {
    await renderInspector('read_notes')
    fireEvent.click(within(await screen.findByRole('group', { name: 'MCP servers' })).getByRole('radio', { name: /list_directory/ }))
    expect(await screen.findByText(/does not know this tool’s inputs yet/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Add an input' })).toBeInTheDocument()
  })

  it('shows a plugin tool’s inputs in the Run an agent tools picker', async () => {
    await renderInspector('lead_agent')
    const plugins = await screen.findByRole('group', { name: 'Plugins' })
    expect(await within(plugins).findByText('Inputs: query*, max_results')).toBeInTheDocument()
  })

  it('keeps text with values in it as text, whatever the schema type', () => {
    expect(toSchemaToolParameter('{{#ask_input.count#}}', { type: 'integer' })).toEqual({ type: 'variable', value: ['ask_input', 'count'] })
    expect(toSchemaToolParameter('yes', { type: 'boolean' })).toEqual({ type: 'constant', value: 'yes' })
    expect(toSchemaToolParameter('true', { type: ['boolean', 'null'] })).toEqual({ type: 'constant', value: true })
  })
})

describe('HTTP sign-in with saved secrets', () => {
  beforeEach(async () => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    resetSampleCredentials()
    await addFixtureNodes()
  })

  async function openApiKeySignIn() {
    await renderInspector('add_to_crm')
    fireEvent.click(screen.getByRole('button', { name: 'Sign-in' }))
    fireEvent.click(screen.getByRole('radio', { name: 'API key' }))
    return screen.findByRole('combobox', { name: 'Secret' })
  }

  it('picks any saved secret and declares it in the agent', async () => {
    const secretSelect = await openApiKeySignIn()
    await waitFor(() => expect(within(secretSelect).getByRole('option', { name: 'GOOGLE_PLACES_API_KEY · saved' })).toBeInTheDocument())

    fireEvent.change(secretSelect, { target: { value: 'GOOGLE_PLACES_API_KEY' } })

    expect(currentNode('add_to_crm').config.authorization).toMatchObject({ type: 'api-key', config: { type: 'bearer', api_key: '{{#env.GOOGLE_PLACES_API_KEY#}}' } })
    expect(harness.controller?.graph?.env).toContainEqual({ name: 'GOOGLE_PLACES_API_KEY', description: null, isSecret: true, hasDefault: false })
    expect(harness.controller?.pendingDescriptions.at(-1)).toBe('used secret GOOGLE_PLACES_API_KEY on Add the leads to our CRM')
    const saved = await harness.controller?.save()
    expect(saved?.graph.env.map((variable) => variable.name)).toContain('GOOGLE_PLACES_API_KEY')
  })

  it('adds a new secret inline without ever showing its value, then uses it', async () => {
    const user = userEvent.setup()
    const secretSelect = await openApiKeySignIn()
    fireEvent.change(secretSelect, { target: { value: '__add_secret__' } })
    const form = await screen.findByRole('form', { name: 'Add a secret' })
    await user.type(within(form).getByPlaceholderText('MY_SERVER_TOKEN'), 'crm_token')
    const valueInput = within(form).getByLabelText('Value')
    expect(valueInput).toHaveAttribute('type', 'password')
    await user.type(valueInput, 's3cr3t-value')
    await user.click(within(form).getByRole('button', { name: 'Save secret' }))

    await waitFor(() => expect(currentNode('add_to_crm').config.authorization).toMatchObject({ config: { api_key: '{{#env.CRM_TOKEN#}}' } }))
    expect(screen.queryByRole('form', { name: 'Add a secret' })).not.toBeInTheDocument()
    expect(screen.queryByText(/s3cr3t-value/)).not.toBeInTheDocument()
    expect(JSON.stringify(harness.controller?.graph)).not.toContain('s3cr3t-value')
    expect((await listAllWorkflowSecrets()).find((secret) => secret.name === 'CRM_TOKEN')?.configured).toBe(true)
  })

  it('declares a secret once', () => {
    const graph = { env: [] } as unknown as Parameters<typeof withSecretDeclared>[0]
    const once = withSecretDeclared(graph, 'API_TOKEN')
    expect(withSecretDeclared(once, 'API_TOKEN')).toBe(once)
    expect(toGraphEdit({ ...once, nodes: [], edges: [] }).declareSecrets).toEqual(['API_TOKEN'])
  })
})
