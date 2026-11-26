import { useState } from 'react'
import { Link } from 'react-router-dom'
import { listProviderStatuses, setDefaultModel } from '@/api/credentials'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { useDefaultModel } from '@/hooks/useDefaultModel'
import { describeError } from '@/lib/agentDisplay'
import { buildModelOptionGroups, describeCompactModelChoice, modelChoiceKey } from '@/lib/modelChoices'
import { connectionsTabPath } from '@/routes'
import { messages } from '@/i18n'

const chipClassNames = 'flex h-[30px] items-center gap-1.5 rounded-lg bg-canvas px-2.5 text-[13px] text-ink-2'

/**
 * The model new agents use, shown as a chip under the prompt. It is a picker listing,
 * per connected provider, every chat model the provider offers for the stored key
 * (asked from the provider; the recommended model while loading or if that fails). Changing it updates the default
 * (the same setting as Settings › Default AI model). With no provider it links to Connections.
 */
export function ModelPickerChip({ label = messages().newAgent.modelForNewAgents }: { label?: string }) {
  const defaultModelState = useDefaultModel()
  const statusesState = useAsyncData(() => listProviderStatuses(), [])
  const availableModelsState = useAvailableModels()
  const [isSaving, setIsSaving] = useState(false)
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)
  const defaultModel = defaultModelState.data

  if (defaultModelState.isLoading) return <span className={chipClassNames}>{messages().newAgent.checkingModel}</span>
  if (!defaultModel) {
    return (
      <span className={chipClassNames}>
        <Link to={connectionsTabPath('models')} className="font-medium">
          {defaultModelState.error ? messages().newAgent.couldNotCheckTheModel : messages().newAgent.connectAModel}
        </Link>
      </span>
    )
  }

  const groups = buildModelOptionGroups(defaultModel, statusesState.data ?? [], availableModelsState.data)
  const choices = groups.flatMap((group) => group.choices)

  async function selectModel(choiceKey: string) {
    const choice = choices.find((candidate) => modelChoiceKey(candidate) === choiceKey)
    if (!choice || choiceKey === modelChoiceKey(defaultModel!)) return
    setIsSaving(true)
    setSaveErrorMessage(null)
    try {
      await setDefaultModel(choice)
      await defaultModelState.reload()
    } catch (saveError) {
      setSaveErrorMessage(messages().newAgent.couldNotChangeTheModelReason(describeError(saveError)))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <span className="flex items-center gap-2">
      <label className={`${chipClassNames} cursor-pointer pr-1`}>
        <span className="sr-only">{label}</span>
        <select
          value={modelChoiceKey(defaultModel)}
          onChange={(event) => void selectModel(event.target.value)}
          disabled={isSaving}
          className="cursor-pointer border-0 bg-transparent text-[13px] text-ink-2 outline-none"
        >
          {groups.map((group) => (
            <optgroup key={group.provider} label={group.note ? `${group.label} (${group.note})` : group.label}>
              {group.choices.map((choice) => (
                <option key={modelChoiceKey(choice)} value={modelChoiceKey(choice)}>
                  {describeCompactModelChoice(choice)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {saveErrorMessage && (
        <span role="alert" className="text-[12px] text-danger">
          {saveErrorMessage}
        </span>
      )}
    </span>
  )
}
