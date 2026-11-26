import { useState } from 'react'
import { Button, Icon } from '@/components/ui'
import { AddSecretForm } from './AddSecretForm'
import { ConnectionsSection, useOpensAddForm } from './ConnectionsSection'
import { SecretsList, type SecretsListState } from './SecretRows'
import { messages } from '@/i18n'

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
      title={messages().connections.secrets2}
      description={messages().connections.serverLoginsApiTokensAndPasswords}
      action={
        !isAdding && (
          <Button variant="secondary" size="sm" onClick={() => setIsAdding(true)}>
            <Icon name="plus" size={14} />
            {messages().connections.addSecret}
          </Button>
        )
      }
    >
      {isAdding && <AddSecretForm onAdded={secretsState.reload} onClose={() => setIsAdding(false)} />}
      <SecretsList secretsState={secretsState} />
    </ConnectionsSection>
  )
}
