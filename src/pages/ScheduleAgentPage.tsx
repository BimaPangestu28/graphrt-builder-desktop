import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/ui'
import {
  approvalModeOptions,
  defaultScheduleSettings,
  scheduleTimeZoneOptions,
  type AgentScheduleSettings,
  type ApprovalMode,
} from '@/data/scheduleAgent'
import { routePaths } from '@/routes'
import { ScheduleBackdrop } from '@/pages/schedule-agent/ScheduleBackdrop'
import { FrequencyRadioTiles, ScheduleFieldset, StackedField, scheduleControlClassNames } from '@/pages/schedule-agent/ScheduleFormFields'

function RunnerAwakeNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-canvas px-4 py-3.5">
      <Icon name="monitor" size={18} className="mt-px shrink-0 text-ink-2" />
      <span className="flex flex-col gap-1 leading-normal">
        <span>Runs while this Mac is awake. A missed run starts when it wakes up</span>
        <Link to={routePaths.settings} className="font-medium">
          Want it always on? Run it on your own server, free
        </Link>
      </span>
    </div>
  )
}

/** Closes the dialog when Escape is pressed anywhere on the page. */
function useCloseOnEscape(onClose: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
}

/**
 * Screen 08 · Schedule the agent.
 * A modal over the dimmed builder: pick when "Maps leads to WhatsApp" runs, what each run searches for,
 * and how approvals work. "Activate agent" saves and goes Home (09); Cancel, the close button
 * and Escape go back to the test result (07). Choosing "By hand" disables the time fields.
 */
export function ScheduleAgentPage() {
  const navigate = useNavigate()
  const titleId = useId()
  const [scheduleSettings, setScheduleSettings] = useState<AgentScheduleSettings>(defaultScheduleSettings)
  const isManualOnly = scheduleSettings.frequency === 'manual'

  const updateSetting = <Key extends keyof AgentScheduleSettings>(key: Key, value: AgentScheduleSettings[Key]) =>
    setScheduleSettings((previousSettings) => ({ ...previousSettings, [key]: value }))

  const closeDialog = useCallback(() => navigate(routePaths.runResult), [navigate])
  useCloseOnEscape(closeDialog)

  const activateAgent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigate(routePaths.home, { state: { activatedSchedule: scheduleSettings } })
  }

  return (
    <div className="relative box-border flex min-h-screen flex-wrap bg-canvas text-[14px] text-ink">
      <ScheduleBackdrop />
      <div className="absolute inset-0 box-border flex items-center justify-center overflow-y-auto bg-[rgba(24,24,27,0.45)] p-6">
        <form
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onSubmit={activateAgent}
          className="box-border flex w-full max-w-[620px] flex-col gap-6 rounded-[20px] bg-surface p-8 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="m-0 text-[24px] font-semibold">
                Run it on a schedule
              </h2>
              <span className="text-body">Maps leads to WhatsApp</span>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={closeDialog}
              className="flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-canvas text-ink-2 hover:bg-selected"
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <ScheduleFieldset legend="When">
            <FrequencyRadioTiles value={scheduleSettings.frequency} onChange={(frequency) => updateSetting('frequency', frequency)} />
            <div className="grid grid-cols-2 gap-2.5">
              <StackedField label="Time">
                <input
                  type="time"
                  value={scheduleSettings.time}
                  disabled={isManualOnly}
                  onChange={(event) => updateSetting('time', event.target.value)}
                  className={`${scheduleControlClassNames} disabled:opacity-50`}
                />
              </StackedField>
              <StackedField label="Time zone">
                <select
                  value={scheduleSettings.timeZone}
                  disabled={isManualOnly}
                  onChange={(event) => updateSetting('timeZone', event.target.value)}
                  className={`${scheduleControlClassNames} px-2.5 disabled:opacity-50`}
                >
                  {scheduleTimeZoneOptions.map((timeZone) => (
                    <option key={timeZone.value} value={timeZone.value}>
                      {timeZone.label}
                    </option>
                  ))}
                </select>
              </StackedField>
            </div>
          </ScheduleFieldset>

          <ScheduleFieldset legend="Each run">
            <div className="grid grid-cols-2 gap-2.5">
              <StackedField label="Search for">
                <input
                  type="text"
                  value={scheduleSettings.searchKeyword}
                  onChange={(event) => updateSetting('searchKeyword', event.target.value)}
                  className={scheduleControlClassNames}
                />
              </StackedField>
              <StackedField label="City">
                <input type="text" value={scheduleSettings.city} onChange={(event) => updateSetting('city', event.target.value)} className={scheduleControlClassNames} />
              </StackedField>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={scheduleSettings.skipAlreadyMessaged}
                onChange={(event) => updateSetting('skipAlreadyMessaged', event.target.checked)}
                className="size-[18px] accent-brand"
              />
              Skip places I already messaged
            </label>
            <StackedField label="Approval">
              <select
                value={scheduleSettings.approvalMode}
                onChange={(event) => updateSetting('approvalMode', event.target.value as ApprovalMode)}
                className={`${scheduleControlClassNames} px-2.5`}
              >
                {approvalModeOptions.map((approvalMode) => (
                  <option key={approvalMode.value} value={approvalMode.value}>
                    {approvalMode.label}
                  </option>
                ))}
              </select>
            </StackedField>
          </ScheduleFieldset>

          <RunnerAwakeNotice />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDialog}
              className="h-11 cursor-pointer rounded-xl border border-line-strong bg-surface px-[18px] text-[14px] font-medium text-ink hover:bg-subtle"
            >
              Cancel
            </button>
            <button type="submit" className="h-11 cursor-pointer rounded-xl border-0 bg-ink px-5 text-[14px] font-semibold text-white hover:bg-ink-2">
              Activate agent
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
