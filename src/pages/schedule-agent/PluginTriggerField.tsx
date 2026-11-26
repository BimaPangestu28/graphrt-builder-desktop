import { useEffect, useId, useState } from 'react'
import { getAgentPluginTrigger, listPluginTriggers, setAgentPluginTrigger, triggerKey } from '@/api/pluginTriggers'
import type { AvailablePluginTrigger, TriggerRef } from '@/api/pluginTriggerTypes'
import { messages } from '@/i18n'
import { scheduleControlClassNames } from './ScheduleFormFields'

/** The schedule form's "Also run on an event" choice, saved with "Activate agent". */
export interface PluginTriggerChoice {
  available: AvailablePluginTrigger[]
  /** `<plugin>.<trigger>`, or '' for none. */
  selectedKey: string
  setSelectedKey: (key: string) => void
  /** Saves the choice when it differs from the stored one. */
  save: () => Promise<void>
}

/**
 * Loads the installed plugins' triggers and the agent's choice.
 *
 * @param agentId - The agent being scheduled (string)
 * @returns The choice and its save function (PluginTriggerChoice)
 */
export function usePluginTriggerChoice(agentId: string): PluginTriggerChoice {
  const [available, setAvailable] = useState<AvailablePluginTrigger[]>([])
  const [storedKey, setStoredKey] = useState('')
  const [selectedKey, setSelectedKey] = useState('')

  useEffect(() => {
    let isCurrent = true
    void Promise.all([listPluginTriggers(), getAgentPluginTrigger(agentId)])
      .then(([triggers, chosen]) => {
        if (!isCurrent) return
        const key = chosen ? triggerKey(chosen) : ''
        setAvailable(triggers)
        setStoredKey(key)
        setSelectedKey(key)
      })
      .catch((loadError: unknown) => console.error('Could not load plugin triggers', loadError))
    return () => {
      isCurrent = false
    }
  }, [agentId])

  async function save() {
    if (selectedKey === storedKey) return
    const chosen: TriggerRef | null = available.find((trigger) => triggerKey(trigger) === selectedKey) ?? null
    const saved = await setAgentPluginTrigger(agentId, chosen)
    setStoredKey(saved ? triggerKey(saved) : '')
  }

  return { available, selectedKey, setSelectedKey, save }
}

/** A select under "When": none, or one trigger per installed plugin trigger. Hidden when there are none. */
export function PluginTriggerField({ choice }: { choice: PluginTriggerChoice }) {
  const selectId = useId()
  if (choice.available.length === 0) return null
  const t = messages().schedule
  const selected = choice.available.find((trigger) => triggerKey(trigger) === choice.selectedKey)
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-[13px] font-medium">
        {t.alsoRunOnAnEvent}
      </label>
      <select
        id={selectId}
        value={choice.selectedKey}
        onChange={(event) => choice.setSelectedKey(event.target.value)}
        className={`${scheduleControlClassNames} px-2.5`}
      >
        <option value="">{t.noEvent}</option>
        {choice.available.map((trigger) => (
          <option key={triggerKey(trigger)} value={triggerKey(trigger)}>
            {`${trigger.pluginDisplayName}: ${trigger.title}`}
          </option>
        ))}
      </select>
      {selected && (
        <span className="text-[13px] text-muted">
          {selected.problem ? <span className="text-danger">{selected.problem}</span> : t.eachEventStartsARun}
        </span>
      )}
    </div>
  )
}
