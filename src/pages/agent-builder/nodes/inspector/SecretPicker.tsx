import { useState } from 'react'
import type { AgentGraph } from '@/api/agentGraphTypes'
import { listAllWorkflowSecrets } from '@/api/credentials'
import { useAsyncData } from '@/hooks/useAsyncData'
import { AddSecretForm } from '@/pages/connections/AddSecretForm'
import { hintClassName, SelectInput } from './fields'

/**
 * Picks the secret a step signs in with (HTTP request, spec B9): the agent's own secrets
 * and every secret saved in the Secrets store (names only, never values), or "Add a new
 * secret…", which opens the add-secret form in place. A secret the agent does not declare
 * yet is added to its `env` by the caller ({@link withSecretDeclared}).
 */

/** The select value that opens the add-secret form. */
const addSecretChoice = '__add_secret__'

/**
 * `graph` with `secretName` declared in its env as a secret (unchanged when it already is).
 * `toGraphEdit` sends secret env names as `declareSecrets`, so the saved document gets it too.
 *
 * @example
 * withSecretDeclared(graph, 'CRM_TOKEN').env.at(-1) // { name: 'CRM_TOKEN', isSecret: true, … }
 */
export function withSecretDeclared(graph: AgentGraph, secretName: string): AgentGraph {
  if (graph.env.some((variable) => variable.name === secretName)) return graph
  return { ...graph, env: [...graph.env, { name: secretName, description: null, isSecret: true, hasDefault: false }] }
}

/** Names of the secrets saved in the Secrets store; empty when the list cannot be read. */
async function loadSavedSecretNames(): Promise<string[]> {
  try {
    const secrets = await listAllWorkflowSecrets()
    return secrets.filter((secret) => secret.configured).map((secret) => secret.name)
  } catch (rawError) {
    console.warn('Could not list the saved secrets for the sign-in picker', rawError)
    return []
  }
}

interface SecretPickerProps {
  graph: AgentGraph
  /** The secret in use, or '' when none. */
  value: string
  disabled: boolean
  /** A secret was chosen or just added; the caller writes the reference and declares it. */
  onPick: (secretName: string) => void
}

export function SecretPicker({ graph, value, disabled, onPick }: SecretPickerProps) {
  const { data: savedNames, reload } = useAsyncData(loadSavedSecretNames, [])
  const [isAdding, setIsAdding] = useState(false)
  const agentSecrets = graph.env.filter((variable) => variable.isSecret || variable.name === value)
  const agentNames = new Set(agentSecrets.map((variable) => variable.name))
  const otherSaved = (savedNames ?? []).filter((name) => !agentNames.has(name))
  const savedSet = new Set(savedNames ?? [])
  const options = [
    ...agentSecrets.map((variable) => ({ value: variable.name, label: `${variable.name} · ${savedSet.has(variable.name) ? 'saved' : 'not saved yet'} · this agent` })),
    ...otherSaved.map((name) => ({ value: name, label: `${name} · saved` })),
    { value: addSecretChoice, label: 'Add a new secret…' },
  ]
  return (
    <div className="flex flex-col gap-2">
      <SelectInput
        ariaLabel="Secret"
        value={value}
        disabled={disabled}
        options={options}
        onChange={(choice) => {
          if (choice === addSecretChoice) {
            setIsAdding(true)
            return
          }
          if (choice) onPick(choice)
        }}
      />
      {value && !savedSet.has(value) && savedNames && <p className="m-0 text-[12px] text-amber-strong">{value} has no value yet. Add it in Connections › Secrets, or add a new secret here</p>}
      {isAdding && (
        <AddSecretForm
          onAdded={async (secretName) => {
            await reload()
            onPick(secretName)
            setIsAdding(false)
          }}
          onClose={() => setIsAdding(false)}
        />
      )}
      {!isAdding && options.length === 1 && <p className={hintClassName}>No saved secrets yet. Add one (e.g. API_TOKEN); its value goes to the keychain and is never shown here.</p>}
    </div>
  )
}
