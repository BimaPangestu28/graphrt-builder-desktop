import { describe, expect, it } from 'vitest'
import { buildServerInput } from './McpServersSection'
import { describeSignIn } from './McpSignIn'

const urlValues = { name: 'remote', transportKind: 'http' as const, command: '', argumentsText: '', url: 'https://mcp.example.com/mcp', secretsText: 'MCP_TOKEN' }

describe('buildServerInput', () => {
  it('sends the chosen sign-in for a URL server', () => {
    expect(buildServerInput({ ...urlValues, urlAuth: 'bearer' })).toMatchObject({ auth: 'bearer', bearerTokenSecret: 'MCP_TOKEN' })
    expect(buildServerInput({ ...urlValues, urlAuth: 'oauth' })).toMatchObject({ auth: 'oauth', bearerTokenSecret: null })
    expect(buildServerInput({ ...urlValues, urlAuth: 'none' })).toMatchObject({ auth: 'none', bearerTokenSecret: null })
    expect(buildServerInput({ ...urlValues, secretsText: '', urlAuth: 'bearer' })).toMatchObject({ auth: 'none', bearerTokenSecret: null })
  })

  it('keeps command servers without auth', () => {
    const input = buildServerInput({ ...urlValues, transportKind: 'stdio', command: 'npx', argumentsText: '-y srv', secretsText: 'A, B', urlAuth: 'oauth' })
    expect(input).toEqual({ name: 'remote', transport: { kind: 'stdio', command: 'npx', args: ['-y', 'srv'] }, secretEnv: ['A', 'B'], bearerTokenSecret: null })
  })
})

describe('describeSignIn', () => {
  it('names each state', () => {
    expect(describeSignIn(null)).toBe('Not signed in')
    expect(describeSignIn({ state: 'signedOut' })).toBe('Not signed in')
    expect(describeSignIn({ state: 'signedIn', signedInAt: null })).toBe('Signed in')
    expect(describeSignIn({ state: 'expired', reason: 'revoked' })).toBe('Sign in again: revoked')
  })
})
