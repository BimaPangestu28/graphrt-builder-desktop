import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import { describeApprovalAction, describeRequirementPermissions, describeRequirementState, summarizePluginRequirements } from './pluginRequirementDisplay'

function requirement(overrides: Partial<PluginRequirement> = {}): PluginRequirement {
  return {
    name: 'google-maps-scraper',
    description: 'Searches Google Maps',
    usedBySteps: ['Search Google Maps'],
    permissions: { network: true, secrets: false, env: ['GOOGLE_MAPS_LANGUAGE'] },
    needsBrowser: true,
    warning: null,
    installed: false,
    trusted: false,
    trustNotNeeded: true,
    missingConfig: [],
    browserReady: false,
    ready: false,
    ...overrides,
  }
}

describe('plugin requirement display', () => {
  it('summarizes how many plugins are ready', () => {
    expect(summarizePluginRequirements([requirement(), requirement({ ready: true })])).toBe('This agent needs 2 plugins · 1 ready')
    expect(summarizePluginRequirements([requirement({ ready: true }), requirement({ ready: true })])).toBe('This agent needs 2 plugins · all ready')
    expect(summarizePluginRequirements([requirement()])).toBe('This agent needs 1 plugin · 0 ready')
  })

  it('describes permissions in plain words, naming the secret settings', () => {
    expect(describeRequirementPermissions(requirement())).toEqual([
      'Uses the internet',
      'Reads settings (optional): GOOGLE_MAPS_LANGUAGE',
      'Opens web pages in a browser (Chromium) on this computer',
    ])
    expect(describeRequirementPermissions(requirement({ needsBrowser: false, permissions: { network: false, secrets: true, env: ['API_TOKEN'] } }))).toEqual([
      'Works without the internet',
      'Asks for secrets or tokens: API_TOKEN',
    ])
  })

  it('names the approval and the state by what is still missing', () => {
    expect(describeApprovalAction(requirement())).toBe('Install')
    expect(describeApprovalAction(requirement({ trustNotNeeded: false }))).toBe('Install & trust')
    expect(describeApprovalAction(requirement({ installed: true, trustNotNeeded: false }))).toBe('Trust')
    expect(describeRequirementState(requirement())).toBe('Not installed')
    expect(describeRequirementState(requirement({ installed: true, trustNotNeeded: false }))).toBe('Needs your trust')
    expect(describeRequirementState(requirement({ installed: true, missingConfig: ['A', 'B'] }))).toBe('Needs 2 settings')
    expect(describeRequirementState(requirement({ installed: true }))).toBe('Needs the browser')
    expect(describeRequirementState(requirement({ ready: true }))).toBe('Ready')
  })
})
