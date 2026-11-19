/**
 * Mock data for the "Maps leads to WhatsApp" agent used by screens 02 to 04. Its steps and
 * versions live in the sample backend (`src/api/sampleBackend/sampleAgentCatalog.ts`).
 */

export const mapsLeadsAgentName = 'Maps leads to WhatsApp'

export const mapsLeadsJobDescription =
  'Find cafes in Bandar Lampung on Google Maps, get their name and phone number, then send each one a WhatsApp message offering our catering menu'

/** Visual role of a step's number badge: plain, approval (amber), or edited by the last chat change (brand). */
export type BuilderStepTone = 'plain' | 'approval' | 'changed'

/** Pause between a finished build (03) and opening the builder (04). */
export const openBuilderDelayMs = 1200

/** A connection the agent needs before it can run (Needs panel on 04). */
export interface AgentRequirement {
  label: string
  isConnected: boolean
}

/**
 * App connections each sample agent needs (Needs panel on 04). Model keys come from the
 * backend (flow summary + provider statuses); app connections are not reported by the
 * backend yet, so they stay mock data keyed by agent id.
 */
export const appRequirementsByAgentId: Record<string, AgentRequirement[]> = {
  'maps-leads': [
    { label: 'Google Places API key', isConnected: true },
    { label: 'WhatsApp on this computer', isConnected: false },
  ],
}
