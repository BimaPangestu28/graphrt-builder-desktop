import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createTrigger } from '@/api/triggers'
import type { NewTrigger } from '@/api/types'
import { Icon } from '@/components/ui'
import {
  approvalModeOptions,
  defaultScheduleSettings,
  scheduleTimeZoneOptions,
  type AgentScheduleSettings,
  type ApprovalMode,
} from '@/pages/schedule-agent/scheduleOptions'
import { useSchedulePreview } from '@/hooks/useTriggers'
import { buildCronExpression, formatFireTime } from '@/lib/schedule'
import { agentPath, routePaths, sampleAgentId } from '@/routes'
import { ScheduleBackdrop } from '@/pages/schedule-agent/ScheduleBackdrop'
import { FrequencyRadioTiles, ScheduleFieldset, StackedField, WeekdayToggleGroup, scheduleControlClassNames } from '@/pages/schedule-agent/ScheduleFormFields'
import { toError } from '@/lib/errors'
import { messages } from '@/i18n'

/** The dialog promises "A missed run starts when it wakes up": the run-once policy. */
const dialogMissedRunPolicy = 'run_once'

function RunnerAwakeNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-canvas px-4 py-3.5">
      <Icon name="monitor" size={18} className="mt-px shrink-0 text-ink-2" />
      <span className="flex flex-col gap-1 leading-normal">
        <span>{messages().schedule.runsWhileThisComputerIsAwake}</span>
        <Link to={routePaths.settings} className="font-medium">
          {messages().schedule.wantItAlwaysOnRunIt}
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

/** Cron expression for the form's "When" choice, or null for "By hand" or an incomplete choice. */
function buildSettingsCron(settings: AgentScheduleSettings): string | null {
  return buildCronExpression({ frequency: settings.frequency, time: settings.time, customWeekdays: settings.customWeekdays })
}

/** The trigger to create for the form, or null when nothing should be scheduled. */
export function buildNewTrigger(agentId: string, settings: AgentScheduleSettings): NewTrigger | null {
  const cronExpression = buildSettingsCron(settings)
  if (!cronExpression) return null
  return {
    agentId,
    cronExpression,
    timezone: settings.timeZone,
    missedRunPolicy: dialogMissedRunPolicy,
    inputs: {
      keyword: settings.searchKeyword,
      city: settings.city,
      skipAlreadyMessaged: settings.skipAlreadyMessaged,
      approvalMode: settings.approvalMode,
    },
  }
}

/** "Next runs: Thu 19 Nov 09:00 · Fri 20 Nov 09:00 …" under the time fields. */
function NextRunsPreview({ settings }: { settings: AgentScheduleSettings }) {
  const cronExpression = buildSettingsCron(settings)
  const { fireTimes, error } = useSchedulePreview(cronExpression, settings.timeZone)
  if (settings.frequency === 'manual') return <span className="text-[13px] text-body">{messages().schedule.runsOnlyWhenYouStartIt}</span>
  if (!cronExpression) return <span className="text-[13px] text-body">{messages().schedule.pickATimeAndAtLeast}</span>
  if (error) return <span className="text-[13px] text-danger">{messages().schedule.couldNotPreviewThisSchedule}{' '}{error.message}</span>
  if (fireTimes.length === 0) return null
  return (
    <span aria-live="polite" className="text-[13px] text-body">
      {messages().schedule.nextRuns}{' '}{fireTimes.map((fireTime) => formatFireTime(fireTime, settings.timeZone)).join(' · ')}
    </span>
  )
}

/**
 * Screen 08 · Schedule the agent (`/agents/:agentId/schedule`).
 * A modal over the dimmed builder: pick when the agent runs, what each run searches for, and how
 * approvals work. The "When" choice becomes a cron expression whose next fire times are previewed;
 * "Activate agent" creates the trigger and goes Home (09). Cancel, the close button and Escape go
 * back to the test result (07). Choosing "By hand" disables the time fields and creates no trigger.
 */
export function ScheduleAgentPage() {
  const navigate = useNavigate()
  const { agentId = sampleAgentId } = useParams()
  const titleId = useId()
  const [scheduleSettings, setScheduleSettings] = useState<AgentScheduleSettings>(defaultScheduleSettings)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<Error | null>(null)
  const isManualOnly = scheduleSettings.frequency === 'manual'

  const updateSetting = <Key extends keyof AgentScheduleSettings>(key: Key, value: AgentScheduleSettings[Key]) =>
    setScheduleSettings((previousSettings) => ({ ...previousSettings, [key]: value }))

  const closeDialog = useCallback(() => navigate(agentPath('runResult', agentId)), [navigate, agentId])
  useCloseOnEscape(closeDialog)

  const activateAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const newTrigger = buildNewTrigger(agentId, scheduleSettings)
    if (!newTrigger && !isManualOnly) {
      setSaveError(new Error(messages().schedule.pickATimeAndAtLeast))
      return
    }
    setIsSaving(true)
    setSaveError(null)
    try {
      const trigger = newTrigger ? await createTrigger(newTrigger) : null
      navigate(routePaths.home, { state: { activatedSchedule: scheduleSettings, triggerId: trigger?.id ?? null } })
    } catch (createFailure) {
      setSaveError(toError(createFailure))
      setIsSaving(false)
    }
  }

  return (
    <div className="relative box-border flex min-h-screen flex-wrap bg-canvas text-[14px] text-ink">
      <ScheduleBackdrop />
      <div className="absolute inset-0 box-border flex items-center justify-center overflow-y-auto bg-[rgba(24,24,27,0.45)] p-6">
        <form
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onSubmit={(event) => void activateAgent(event)}
          className="box-border flex w-full max-w-[620px] flex-col gap-6 rounded-[20px] bg-surface p-8 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="m-0 text-[24px] font-semibold">
                {messages().schedule.runItOnASchedule}
              </h2>
              <span className="text-body">{messages().schedule.mapsLeadsToWhatsapp}</span>
            </div>
            <button
              type="button"
              aria-label={messages().schedule.close}
              onClick={closeDialog}
              className="flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-canvas text-ink-2 hover:bg-selected"
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <ScheduleFieldset legend={messages().schedule.when}>
            <FrequencyRadioTiles value={scheduleSettings.frequency} onChange={(frequency) => updateSetting('frequency', frequency)} />
            {scheduleSettings.frequency === 'custom' && (
              <WeekdayToggleGroup value={scheduleSettings.customWeekdays} onChange={(weekdays) => updateSetting('customWeekdays', weekdays)} />
            )}
            <div className="grid grid-cols-2 gap-2.5">
              <StackedField label={messages().schedule.time}>
                <input
                  type="time"
                  value={scheduleSettings.time}
                  disabled={isManualOnly}
                  onChange={(event) => updateSetting('time', event.target.value)}
                  className={`${scheduleControlClassNames} disabled:opacity-50`}
                />
              </StackedField>
              <StackedField label={messages().schedule.timeZone}>
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
            <NextRunsPreview settings={scheduleSettings} />
          </ScheduleFieldset>

          <ScheduleFieldset legend={messages().schedule.eachRun}>
            <div className="grid grid-cols-2 gap-2.5">
              <StackedField label={messages().schedule.searchFor}>
                <input
                  type="text"
                  value={scheduleSettings.searchKeyword}
                  onChange={(event) => updateSetting('searchKeyword', event.target.value)}
                  className={scheduleControlClassNames}
                />
              </StackedField>
              <StackedField label={messages().schedule.city}>
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
              {messages().schedule.skipPlacesIAlreadyMessaged}
            </label>
            <StackedField label={messages().schedule.approval}>
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

          {saveError && (
            <div role="alert" className="rounded-xl border border-danger-soft px-4 py-3 text-[13px] text-danger">
              {messages().schedule.couldNotActivateTheSchedule}{' '}{saveError.message}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDialog}
              className="h-11 cursor-pointer rounded-xl border border-line-strong bg-surface px-[18px] text-[14px] font-medium text-ink hover:bg-subtle"
            >
              {messages().schedule.cancel}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="h-11 cursor-pointer rounded-xl border-0 bg-ink px-5 text-[14px] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? messages().schedule.activating : messages().schedule.activateAgent}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
