import { useState } from 'react'
import { Button, Icon } from '@/components/ui'
import { AddSecretForm } from './AddSecretForm'
import { ConnectionsSection, useOpensAddForm } from './ConnectionsSection'
import { SecretsList, type SecretsListState } from './SecretRows'

/**
 * The Secrets tab of screen 21: "Add secret" at the top-right (it unfolds the form above the
 * list), then every secret. `?add=1` opens the form on arrival.
 */
export function SecretsSection({ secretsState }: { secretsState: SecretsListState }) {
  const opensAddForm = useOpensAddForm()
  const [isAdding, setIsAdding] = useState(opensAddForm)

  return (
    <ConnectionsSection
      id="connections-secrets"
      title="Secrets"
      description="Server logins, API tokens and passwords your agents use. Agents only ever see their names"
      action={
        !isAdding && (
          <Button variant="secondary" size="sm" onClick={() => setIsAdding(true)}>
            <Icon name="plus" size={14} />
            Add secret
          </Button>
        )
      }
    >
      {isAdding && <AddSecretForm onAdded={secretsState.reload} onClose={() => setIsAdding(false)} />}
      <SecretsList secretsState={secretsState} />
    </ConnectionsSection>
  )
}
