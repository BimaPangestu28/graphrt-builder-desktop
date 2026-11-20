import { useState } from 'react'
import { Button, Icon } from '@/components/ui'
import { AddSecretForm } from './AddSecretForm'
import { ConnectionsSection, useIsLinkedSection, useScrollToLinkedSection } from './ConnectionsSection'
import { summarizeSecrets } from './secretDisplay'
import { SecretsList, type SecretsListState } from './SecretRows'

const secretsSectionId = 'connections-secrets'
const secretsDescription = 'Server logins, API tokens and passwords your agents use'

/**
 * "Secrets" on screen 21, always open: the summary in the description, "Add secret" on the
 * right (it unfolds the form above the list), then every secret. `?section=secrets` opens
 * the form and scrolls here. While searching it only lists matches and hides the form.
 */
export function SecretsSection({ secretsState }: { secretsState: SecretsListState }) {
  const isLinked = useIsLinkedSection('secrets')
  const [isAdding, setIsAdding] = useState(isLinked)
  useScrollToLinkedSection('secrets', secretsSectionId)
  const { allSecrets, isSearching, reload } = secretsState
  const description = allSecrets ? `${secretsDescription} · ${summarizeSecrets(allSecrets)}` : secretsDescription
  const showsAddForm = isAdding && !isSearching

  return (
    <ConnectionsSection
      id={secretsSectionId}
      title="Secrets"
      description={description}
      action={
        !isSearching &&
        !isAdding && (
          <Button variant="secondary" size="sm" onClick={() => setIsAdding(true)}>
            <Icon name="plus" size={14} />
            Add secret
          </Button>
        )
      }
    >
      {showsAddForm && <AddSecretForm onAdded={reload} onClose={() => setIsAdding(false)} />}
      <SecretsList secretsState={secretsState} />
    </ConnectionsSection>
  )
}
