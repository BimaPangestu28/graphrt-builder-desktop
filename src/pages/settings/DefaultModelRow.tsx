import { useState } from 'react'
import { setDefaultModel } from '@/api/credentials'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { useProviderStatuses } from '@/hooks/useProviderStatuses'
import { describeError } from '@/lib/agentDisplay'
import { buildModelOptionGroups, describeModelChoice } from '@/lib/modelChoices'
import { ActionRow, SelectRow } from './SettingRows'
import { useT } from '@/i18n'

/**
 * "Default AI model for new agents", stored with `setDefaultModel` (the same default the
 * Connections screen marks). Offers every chat model each connected provider reports
 * for its key (the recommended one while loading or when the provider can't be reached).
 */
export function DefaultModelRow() {
  const providerSetupState = useProviderStatuses()
  const availableModelsState = useAvailableModels()
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)
  const providerSetup = providerSetupState.data
  const t = useT().settings
  const title = t.defaultModel

  if (!providerSetup) {
    const status = providerSetupState.error ? t.couldNotLoadModels(describeError(providerSetupState.error)) : t.loadingEllipsis
    return <ActionRow title={title} description={status} action={null} />
  }

  const choices = buildModelOptionGroups(providerSetup.defaultModel, providerSetup.statuses, availableModelsState.data).flatMap(
    (group) => group.choices,
  )
  const labels = choices.map(describeModelChoice)

  async function selectModel(label: string) {
    const choice = choices.find((candidate) => describeModelChoice(candidate) === label)
    if (!choice) return
    setSaveErrorMessage(null)
    try {
      await setDefaultModel(choice)
      await providerSetupState.reload()
    } catch (saveError) {
      setSaveErrorMessage(t.couldNotChangeDefaultModel(describeError(saveError)))
    }
  }

  return (
    <>
      <SelectRow
        title={title}
        description={t.defaultModelHint}
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
