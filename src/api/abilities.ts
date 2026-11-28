import { callBackend, isDesktopApp } from './client'
import type { AbilityChange, AgentAbilities, AgentMemory, ForgottenPerson, MemoryGraph, MemoryNote, SpendingLimit } from './abilitiesTypes'
import { sampleAbilitiesBackend } from './sampleBackend/abilities'

/**
 * An agent's abilities and what it remembers about the people it serves.
 * Outside the desktop app every call goes to the sample backend.
 */

const useSample = () => __SAMPLE_BACKEND__ && !isDesktopApp()

export function getAgentAbilities(agentId: string): Promise<AgentAbilities> {
  if (useSample()) return sampleAbilitiesBackend.getAgentAbilities(agentId)
  return callBackend('get_agent_abilities', { agentId })
}

/**
 * Changes one ability on every step that can use it (saved as a new version).
 *
 * @throws BackendError - `builder_busy` while the builder edits the agent; `invalid_input` for a value outside its bounds
 */
export function setAgentAbility(agentId: string, change: AbilityChange): Promise<AgentAbilities> {
  if (useSample()) return sampleAbilitiesBackend.setAgentAbility(agentId, change)
  return callBackend('set_agent_ability', { agentId, change })
}

/** Sets (or clears, with both parts `null`) the most tokens and money one run may use. */
export function setAgentSpendingLimit(agentId: string, limit: SpendingLimit): Promise<AgentAbilities> {
  if (useSample()) return sampleAbilitiesBackend.setAgentSpendingLimit(agentId, limit)
  return callBackend('set_agent_spending_limit', { agentId, limit })
}

export function getAgentMemory(agentId: string): Promise<AgentMemory> {
  if (useSample()) return sampleAbilitiesBackend.getAgentMemory(agentId)
  return callBackend('get_agent_memory', { agentId })
}

/** The notes about `user` (`null`: the agent's own notes). */
export function listMemoryNotes(agentId: string, user: string | null): Promise<MemoryNote[]> {
  if (useSample()) return sampleAbilitiesBackend.listMemoryNotes(agentId, user)
  return callBackend('list_memory_notes', { agentId, user })
}

export function getMemoryGraph(agentId: string, user: string | null): Promise<MemoryGraph> {
  if (useSample()) return sampleAbilitiesBackend.getMemoryGraph(agentId, user)
  return callBackend('get_memory_graph', { agentId, user })
}

export function deleteMemoryNote(agentId: string, user: string | null, noteId: string): Promise<void> {
  if (useSample()) return sampleAbilitiesBackend.deleteMemoryNote(agentId, user, noteId)
  return callBackend('delete_memory_note', { agentId, user, noteId })
}

/** Uses (`approve`) or removes a note that waits for the owner. */
export function decideMemoryNote(agentId: string, user: string | null, noteId: string, approve: boolean): Promise<MemoryNote | null> {
  if (useSample()) return sampleAbilitiesBackend.decideMemoryNote(agentId, user, noteId, approve)
  return callBackend('decide_memory_note', { agentId, user, noteId, approve })
}

/** Erases every note, the memory graph and the lessons about one person. */
export function forgetMemoryPerson(agentId: string, user: string): Promise<ForgottenPerson> {
  if (useSample()) return sampleAbilitiesBackend.forgetMemoryPerson(agentId, user)
  return callBackend('forget_memory_person', { agentId, user })
}
