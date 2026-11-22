import { useId } from 'react'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { useProviderStatuses } from '@/hooks/useProviderStatuses'
import { buildModelOptionGroups, describeModelName, modelChoiceKey } from '@/lib/modelChoices'
import { readConfigNumber, readConfigObject, readConfigText, type ConfigPath } from './configPaths'
import { Field, inputClassName, NumberInput } from './fields'
import { useInspector } from './InspectorContext'

/**
 * The model of a model step (`model: {provider, name, completion_params}`), picked from
 * the same choices as the rest of the app: every connected provider's chat models, the
 * default model first. A model the agent names that is not connected stays selectable.
 */

interface ModelFieldProps {
  path?: ConfigPath
  /** Also show temperature and max tokens (`completion_params`). */
  showParams?: boolean
}

export function ModelField({ path = ['model'], showParams = false }: ModelFieldProps) {
  const { node, readOnly, setConfigValue } = useInspector()
  const selectId = useId()
  const { data: setup } = useProviderStatuses()
  const { data: catalog } = useAvailableModels()
  const model = readConfigObject(node.config, path)
  const provider = readConfigText(model, ['provider'])
  const name = readConfigText(model, ['name'])
  const currentKey = provider && name ? `${provider}:${name}` : ''
  const groups = setup ? buildModelOptionGroups(setup.defaultModel, setup.statuses, catalog) : []
  const isListed = groups.some((group) => group.choices.some((choice) => modelChoiceKey(choice) === currentKey))

  const pickModel = (key: string) => {
    const separator = key.indexOf(':')
    if (separator < 0) return
    const nextProvider = key.slice(0, separator)
    const nextName = key.slice(separator + 1)
    setConfigValue(path, { ...model, provider: nextProvider, name: nextName }, `set the model to ${nextName}`)
  }
  const setParam = (param: string, value: number | null, what: string) => {
    const params = readConfigObject(model, ['completion_params'])
    const { [param]: _old, ...rest } = params
    const nextParams = value === null ? rest : { ...rest, [param]: value }
    setConfigValue([...path, 'completion_params'], Object.keys(nextParams).length > 0 ? nextParams : undefined, what)
  }

  return (
    <>
      <Field label="Model" htmlFor={selectId} required error={currentKey ? null : 'Pick a model'}>
        <select id={selectId} value={currentKey} disabled={readOnly} onChange={(event) => pickModel(event.target.value)} className={`${inputClassName} cursor-pointer`}>
          {!currentKey && <option value="">Choose a model…</option>}
          {currentKey && !isListed && (
            <option value={currentKey}>
              {provider} · {name}
              {setup ? ' (not connected)' : ''}
            </option>
          )}
          {groups.map((group) => (
            <optgroup key={group.provider} label={group.label}>
              {group.choices.map((choice) => (
                <option key={modelChoiceKey(choice)} value={modelChoiceKey(choice)}>
                  {choice.provider} · {describeModelName(choice)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      {showParams && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Temperature">
            <NumberInput ariaLabel="Temperature" wide value={readConfigNumber(model, ['completion_params', 'temperature'])} min={0} max={2} step={0.1} placeholder="default" disabled={readOnly} onCommit={(value) => setParam('temperature', value, 'set the temperature')} />
          </Field>
          <Field label="Max tokens">
            <NumberInput ariaLabel="Max tokens" wide value={readConfigNumber(model, ['completion_params', 'max_tokens'])} min={1} step={1} placeholder="default" disabled={readOnly} onCommit={(value) => setParam('max_tokens', value === null ? null : Math.round(value), 'set max tokens')} />
          </Field>
        </div>
      )}
    </>
  )
}
