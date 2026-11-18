import { agentPath, agentRoutePatterns, routePaths, sampleAgentId } from './routes'

describe('agentPath', () => {
  it('fills in the agent id', () => {
    expect(agentPath('builder', 'abc')).toBe('/agents/abc/steps')
  })

  it('adds query parameters', () => {
    expect(agentPath('testRun', 'abc', { runId: 'r1' })).toBe('/agents/abc/test?runId=r1')
  })

  it('escapes unsafe ids', () => {
    expect(agentPath('builder', 'a/b')).toBe('/agents/a%2Fb/steps')
  })

  it('matches the sample agent paths', () => {
    for (const routeKey of Object.keys(agentRoutePatterns) as Array<keyof typeof agentRoutePatterns>) {
      expect(agentPath(routeKey, sampleAgentId)).toBe(routePaths[routeKey])
    }
  })
})
