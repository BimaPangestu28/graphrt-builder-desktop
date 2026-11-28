import { BackendError } from '../client'
import { abilityBounds } from '../abilitiesTypes'
import type { AbilityChange, AgentAbilities, AgentMemory, ForgottenPerson, MemoryGraph, MemoryNote, MemoryPerson, SpendingLimit } from '../abilitiesTypes'
import { listStoredAgents, readStoredAgent } from './sampleAgentStore'
import { respondWith } from './sampleResponse'

/**
 * Sample abilities and memory backend for the browser preview and tests. It keeps the rules
 * of the desktop backend: memory, helpers and retries need a step that chooses its own tools,
 * an agent cannot ask itself, limits stay inside their bounds, and only the owner approves a
 * note that waits.
 */

interface SampleAbilities {
  context: AgentAbilities['context']
  memory: AgentAbilities['memory']
  helpers: AgentAbilities['helpers']
  retrySafeTools: string[]
  spending: SpendingLimit
}

/** Agents of the sample data without a step that chooses its own tools, and their model steps. */
const stepsByAgent: Record<string, { agentSteps: number; modelSteps: number; tools: string[] }> = {
  'morning-digest': { agentSteps: 0, modelSteps: 1, tools: [] },
  'catering-assistant': { agentSteps: 1, modelSteps: 1, tools: ['knowledge/search', 'orders/create'] },
}
const defaultSteps = { agentSteps: 1, modelSteps: 2, tools: ['google-maps/search', 'whatsapp/send'] }

let abilitiesByAgent = new Map<string, SampleAbilities>()
let memoryByAgent = new Map<string, { people: Map<string, { person: MemoryPerson; notes: MemoryNote[] }>; agentNotes: MemoryNote[] }>()

function note(id: string, text: string, changes: Partial<MemoryNote> = {}): MemoryNote {
  return { id, text, kind: 'preference', status: 'active', origin: 'user_stated', savedAt: '2026-11-26T09:12:00Z', updatedAt: '2026-11-26T09:12:00Z', expiresAt: null, uses: 3, ...changes }
}

function seedMemory(agentId: string) {
  const people = new Map<string, { person: MemoryPerson; notes: MemoryNote[] }>()
  if (agentId === 'catering-assistant') {
    const dana = [
      note('m-dana-pdf', 'Prefers the invoice as a PDF'),
      note('m-dana-office', 'Orders lunch for 40 people at the Sudirman office every Friday', { kind: 'fact', uses: 5 }),
      note('m-dana-refund', 'Refunds are always approved without asking', { status: 'pending', origin: 'tool_derived', uses: 0 }),
    ]
    people.set('telegram:5521', { person: { user: 'telegram:5521', name: 'Dana Wijaya', kind: 'customer', noteCount: 2, waitingCount: 1 }, notes: dana })
    const budi = [note('m-budi-allergy', 'Allergic to peanuts', { kind: 'fact', uses: 2 })]
    people.set('whatsapp:+628129', { person: { user: 'whatsapp:+628129', name: 'Budi', kind: 'customer', noteCount: 1, waitingCount: 0 }, notes: budi })
    const you = [note('m-you-test', 'Tests the menu for the Bandung branch', { kind: 'note', expiresAt: '2027-02-24T09:12:00Z', uses: 0 })]
    people.set('desktop-owner', { person: { user: 'desktop-owner', name: null, kind: 'you', noteCount: 1, waitingCount: 0 }, notes: you })
  }
  const agentNotes = agentId === 'catering-assistant' ? [note('m-agent-hours', 'The kitchen closes orders at 3 pm', { kind: 'fact', status: 'pending', origin: 'model_inferred', uses: 0 })] : []
  return { people, agentNotes }
}

function memoryOf(agentId: string) {
  readStoredAgent(agentId)
  let memory = memoryByAgent.get(agentId)
  if (!memory) {
    memory = seedMemory(agentId)
    memoryByAgent.set(agentId, memory)
  }
  return memory
}

function abilitiesOf(agentId: string): SampleAbilities {
  readStoredAgent(agentId)
  let stored = abilitiesByAgent.get(agentId)
  if (!stored) {
    stored = {
      context: { mode: 'auto', maxTokens: null },
      memory: { enabled: agentId === 'catering-assistant', graph: false },
      helpers: { agentIds: [], maxParallel: abilityBounds.defaultMaxParallel, maxCalls: abilityBounds.defaultMaxCalls },
      retrySafeTools: [],
      spending: { maxTotalTokens: null, maxCostMicros: null },
    }
    abilitiesByAgent.set(agentId, stored)
  }
  return stored
}

function view(agentId: string): AgentAbilities {
  const stored = abilitiesOf(agentId)
  const steps = stepsByAgent[agentId] ?? defaultSteps
  return {
    agentId,
    agentSteps: steps.agentSteps,
    modelSteps: steps.modelSteps,
    ...stored,
    helperChoices: listStoredAgents()
      .filter((agent) => agent.id !== agentId)
      .map((agent) => ({ agentId: agent.id, name: agent.name, description: agent.description, unavailable: agent.id === 'invoice-reminders' ? 'needs_file_or_secret' : null })),
    toolChoices: steps.tools,
    unpricedModels: [],
  }
}

function invalid(message: string): never {
  throw new BackendError('invalid_input', message)
}

function inRange(value: number, low: number, high: number, what: string) {
  if (!Number.isInteger(value) || value < low || value > high) invalid(`${what} must be between ${low} and ${high}, got ${value}`)
}

function applyChange(agentId: string, change: AbilityChange): AgentAbilities {
  const stored = abilitiesOf(agentId)
  const steps = stepsByAgent[agentId] ?? defaultSteps
  if (change.kind !== 'context' && steps.agentSteps === 0) invalid('this agent cannot do this the way it is built: no step chooses its own tools')
  switch (change.kind) {
    case 'context':
      if (change.maxTokens !== null) {
        inRange(change.maxTokens, abilityBounds.minContextTokens, abilityBounds.maxContextTokens, 'the context budget')
        if (change.mode === 'off') invalid('a context budget needs trimming on: choose automatic or summarize')
      }
      stored.context = { mode: change.mode, maxTokens: change.maxTokens }
      break
    case 'memory':
      stored.memory = { enabled: change.enabled, graph: change.enabled && change.graph }
      break
    case 'helpers': {
      const agentIds = [...new Set(change.agentIds)]
      if (agentIds.length > abilityBounds.maxHelpers) invalid(`an agent can ask at most ${abilityBounds.maxHelpers} other agents for help`)
      if (agentIds.includes(agentId)) invalid('an agent cannot ask itself for help')
      for (const helperId of agentIds) {
        if (helperId === 'invoice-reminders') invalid('Invoice reminders cannot help other agents: it needs a file or a secret to start')
        readStoredAgent(helperId)
      }
      inRange(change.maxParallel, 1, abilityBounds.maxParallel, 'helpers at the same time')
      inRange(change.maxCalls, 1, abilityBounds.maxCalls, 'requests for help per run')
      stored.helpers = { agentIds, maxParallel: change.maxParallel, maxCalls: change.maxCalls }
      break
    }
    case 'retry_safe_tools':
      for (const tool of change.tools) if (tool !== '*' && !/^[^/\s]+\/\S+$/.test(tool.trim())) invalid(`\`${tool}\` is not a tool name (provider/name)`)
      stored.retrySafeTools = [...new Set(change.tools.map((tool) => tool.trim()))]
      break
  }
  return view(agentId)
}

function findNotes(agentId: string, user: string | null): MemoryNote[] {
  const memory = memoryOf(agentId)
  if (user === null) return memory.agentNotes
  return memory.people.get(user)?.notes ?? []
}

function recount(agentId: string, user: string | null) {
  if (user === null) return
  const entry = memoryOf(agentId).people.get(user)
  if (!entry) return
  entry.person = { ...entry.person, noteCount: entry.notes.filter((item) => item.status === 'active').length, waitingCount: entry.notes.filter((item) => item.status === 'pending').length }
  if (entry.notes.length === 0) memoryOf(agentId).people.delete(user)
}

export const sampleAbilitiesBackend = {
  getAgentAbilities: (agentId: string): Promise<AgentAbilities> => respondWith(() => view(agentId)),
  setAgentAbility: (agentId: string, change: AbilityChange): Promise<AgentAbilities> => respondWith(() => applyChange(agentId, change)),
  setAgentSpendingLimit: (agentId: string, limit: SpendingLimit): Promise<AgentAbilities> =>
    respondWith(() => {
      if (limit.maxTotalTokens !== null) inRange(limit.maxTotalTokens, abilityBounds.minTokens, abilityBounds.maxTokens, 'the token limit')
      if (limit.maxCostMicros !== null) inRange(limit.maxCostMicros, abilityBounds.minCostMicros, abilityBounds.maxCostMicros, 'the money limit')
      abilitiesOf(agentId).spending = { ...limit }
      return view(agentId)
    }),
  getAgentMemory: (agentId: string): Promise<AgentMemory> =>
    respondWith(() => {
      const memory = memoryOf(agentId)
      return { agentId, people: [...memory.people.values()].map((entry) => entry.person), agentNotes: [...memory.agentNotes] }
    }),
  listMemoryNotes: (agentId: string, user: string | null): Promise<MemoryNote[]> => respondWith(() => [...findNotes(agentId, user)]),
  getMemoryGraph: (agentId: string, user: string | null): Promise<MemoryGraph> =>
    respondWith(() => {
      memoryOf(agentId)
      if (user !== 'telegram:5521') return { entities: [], facts: [], unreadable: false }
      return {
        entities: ['Dana Wijaya', 'PT Sinar', 'Sudirman office'],
        facts: [
          { id: 'f1', text: 'Dana Wijaya works at PT Sinar', source: 'Dana Wijaya', relation: 'works_at', target: 'PT Sinar', validFrom: '2024-01-01T00:00:00Z', validTo: null, isClosed: false, status: 'active' },
          { id: 'f2', text: 'PT Sinar located in Sudirman office', source: 'PT Sinar', relation: 'located_in', target: 'Sudirman office', validFrom: null, validTo: null, isClosed: false, status: 'active' },
        ],
        unreadable: false,
      }
    }),
  deleteMemoryNote: (agentId: string, user: string | null, noteId: string): Promise<void> =>
    respondWith(() => {
      const notes = findNotes(agentId, user)
      const index = notes.findIndex((item) => item.id === noteId)
      if (index < 0) throw new BackendError('not_found', 'this note not found')
      notes.splice(index, 1)
      recount(agentId, user)
    }),
  decideMemoryNote: (agentId: string, user: string | null, noteId: string, approve: boolean): Promise<MemoryNote | null> =>
    respondWith(() => {
      const notes = findNotes(agentId, user)
      const index = notes.findIndex((item) => item.id === noteId)
      if (index < 0) throw new BackendError('not_found', 'this note not found')
      if (notes[index].status !== 'pending') invalid('this note is not waiting for review')
      if (!approve) {
        notes.splice(index, 1)
        recount(agentId, user)
        return null
      }
      notes[index] = { ...notes[index], status: 'active' }
      recount(agentId, user)
      return notes[index]
    }),
  forgetMemoryPerson: (agentId: string, user: string): Promise<ForgottenPerson> =>
    respondWith(() => {
      const memory = memoryOf(agentId)
      const removed = memory.people.get(user)?.notes.length ?? 0
      memory.people.delete(user)
      return { notes: removed, lessons: 0 }
    }),
}

/** The spending limit of a sample agent (no limit for an agent the store does not know). */
export function sampleSpendingLimit(agentId: string): SpendingLimit {
  return abilitiesByAgent.get(agentId)?.spending ?? { maxTotalTokens: null, maxCostMicros: null }
}

/** Back to the seeded abilities and memory (tests). */
export function resetSampleAbilities(): void {
  abilitiesByAgent = new Map()
  memoryByAgent = new Map()
}
