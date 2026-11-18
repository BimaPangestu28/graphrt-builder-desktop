import { useState } from 'react'
import { setDefaultModel } from '@/api/credentials'
import { useProviderStatuses } from '@/hooks/useProviderStatuses'
import { describeError } from '@/lib/agentDisplay'
import { describeModelChoice, listDefaultModelChoices } from '@/lib/modelChoices'
import { ActionRow, SelectRow } from './SettingRows'

/**
 * "Default AI model for new agents", stored with `setDefaultModel` (the same default the
 * Connections screen marks). Offers the recommended model of each provider with a key.
 */
export function DefaultModelRow() {
  const providerSetupState = useProviderStatuses()
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)
  const providerSetup = providerSetupState.data
  const title = 'Default AI model for new agents'

  if (!providerSetup) {
    const status = providerSetupState.error ? `Could not load the AI models: ${describeError(providerSetupState.error)}` : 'Loading…'
    return <ActionRow title={title} description={status} action={null} />
  }

  const choices = listDefaultModelChoices(providerSetup.statuses, providerSetup.defaultModel)
  const labels = choices.map(describeModelChoice)

  async function selectModel(label: string) {
    const choice = choices.find((candidate) => describeModelChoice(candidate) === label)
    if (!choice) return
    setSaveErrorMessage(null)
    try {
      await setDefaultModel(choice)
      await providerSetupState.reload()
    } catch (saveError) {
      setSaveErrorMessage(`Could not change the default model: ${describeError(saveError)}`)
    }
  }

  return (
    <>
      <SelectRow
        title={title}
        description="Each agent can still pick its own"
        value={describeModelChoice(providerSetup.defaultModel)}
        options={labels}
        onSelect={(label) => void selectModel(label)}
      />
      {saveErrorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {saveErrorMessage}
        </p>
      )}
    </>
  )
}

// Re-exported for existing imports of the Settings row's helpers.
export { describeModelChoice, listDefaultModelChoices } from '@/lib/modelChoices'
