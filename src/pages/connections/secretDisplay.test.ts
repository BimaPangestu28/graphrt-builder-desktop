import type { WorkflowSecretOverview } from '@/api/connectionTypes'
import { describeSecretNameProblem, describeSecretUsers, normalizeSecretName } from './secretDisplay'

function secretOverview(overrides: Partial<WorkflowSecretOverview>): WorkflowSecretOverview {
  return { name: 'API_TOKEN', description: null, isSecret: true, required: false, configured: false, agents: [], mcpServers: [], note: null, createdAt: null, updatedAt: null, ...overrides }
}

describe('secret display helpers', () => {
  it('names who uses a secret, or says it is not used yet', () => {
    expect(describeSecretUsers(secretOverview({ agents: [{ agentId: 'a', agentName: 'Deploy' }], mcpServers: ['github'] }))).toBe('Used by Deploy, MCP server github')
    expect(describeSecretUsers(secretOverview({}))).toBe('Not used yet')
  })

  it('explains what is wrong with a typed name', () => {
    expect(describeSecretNameProblem('  ')).toMatch(/Give the secret a name/)
    expect(describeSecretNameProblem('9LIVES')).toBe('Start the name with a letter')
    expect(describeSecretNameProblem('my_token')).toMatch(/capital letters/)
    expect(describeSecretNameProblem('A'.repeat(65))).toMatch(/64 characters/)
    expect(describeSecretNameProblem('MY_SERVER_TOKEN')).toBeNull()
  })

  it('turns typed words into an UPPER_SNAKE_CASE name', () => {
    expect(normalizeSecretName('my server-token')).toBe('MY_SERVER_TOKEN')
  })

})
