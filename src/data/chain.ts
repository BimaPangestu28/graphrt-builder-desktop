/**
 * Mock data for screen 11 (Chain): three agents run one after another,
 * joined by links that say when the next agent runs and which outputs feed its inputs.
 */

export interface ChainAgent {
  id: string
  name: string
  stepCount: number
  description?: string
  /** Output field names this agent gives to the next one. */
  outputs: string[]
}

/** An output of an earlier agent that can feed an input. */
export interface ChainOutputSource {
  field: string
  agentName: string
}

export type ChainInputBinding =
  | { name: string; kind: 'output'; sources: ChainOutputSource[]; selectedField: string }
  | { name: string; kind: 'text'; value: string }

export interface ChainLink {
  id: string
  fromIndex: number
  inputs: ChainInputBinding[]
  runCondition: string
  failurePolicy: string
}

export const chainName = 'Leads to sales recap'

export const chainAgents: ChainAgent[] = [
  { id: 'maps-leads', name: 'Maps leads to WhatsApp', stepCount: 6, outputs: ['places', 'sent_count'] },
  { id: 'lead-tracker', name: 'Lead tracker', stepCount: 3, description: 'Adds every contacted place to the Leads sheet', outputs: ['new_rows'] },
  { id: 'sales-recap', name: 'Sales recap to Telegram', stepCount: 4, description: 'Sends a short summary to your Telegram', outputs: [] },
]

export const runConditionOptions = ['Only if sent_count is more than 0', 'Always', 'Only if the first agent failed']
export const failurePolicyOptions = ['Retry 3 times, then stop the chain', 'Skip it and keep going']

export const initialChainLinks: ChainLink[] = [
  {
    id: 'link-1',
    fromIndex: 0,
    inputs: [
      {
        name: 'leads',
        kind: 'output',
        sources: [
          { field: 'places', agentName: 'Maps leads' },
          { field: 'sent_count', agentName: 'Maps leads' },
        ],
        selectedField: 'places',
      },
      { name: 'source', kind: 'text', value: 'Google Maps outreach' },
    ],
    runCondition: runConditionOptions[0],
    failurePolicy: failurePolicyOptions[0],
  },
  {
    id: 'link-2',
    fromIndex: 1,
    inputs: [{ name: 'items', kind: 'output', sources: [{ field: 'new_rows', agentName: 'Lead tracker' }], selectedField: 'new_rows' }],
    runCondition: runConditionOptions[1],
    failurePolicy: failurePolicyOptions[1],
  },
]
