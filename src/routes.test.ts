import { agentPath, agentRoutePatterns, agentOpenPath, chatbotSetupPath, pluginDetailPath, routePaths, sampleAgentId, skillAddPath, skillDetailPath } from './routes'

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

describe('pluginDetailPath', () => {
  it('puts the plugin name under /plugins, escaped', () => {
    expect(pluginDetailPath('whatsapp-web')).toBe('/plugins/whatsapp-web')
    expect(pluginDetailPath('a/b')).toBe('/plugins/a%2Fb')
  })
})

describe('skill paths', () => {
  it('keeps the wizards and a skill page apart, escaped', () => {
    expect(skillAddPath('refund-policy')).toBe('/skills/add/refund-policy')
    expect(skillDetailPath('refund-policy')).toBe('/skills/view/refund-policy')
    expect(skillDetailPath('a/b')).toBe('/skills/view/a%2Fb')
    expect(routePaths.skillCreate).toBe('/skills/new')
  })
})

describe('agentOpenPath', () => {
  it('opens a new chatbot in its own setup, never the sample chatbot', () => {
    expect(agentOpenPath('agent-9', 'chatbot')).toBe(chatbotSetupPath('agent-9'))
    expect(agentOpenPath('agent-9', 'chatbot')).toContain('agentId=agent-9')
  })

  it('opens every other kind in the builder', () => {
    for (const kind of ['task', 'chain', 'team'] as const) {
      expect(agentOpenPath('agent-9', kind)).toBe('/agents/agent-9/steps')
    }
  })
})
