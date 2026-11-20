import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isDesktopApp } from '@/api/client'
import { listScheduledRuns } from '@/api/scheduleRules'
import type { Trigger } from '@/api/types'
import { AppShell, PageFrame } from '@/components/layout'
import { StrokeIcon } from '@/components/ui'
import { buildCalendarEntries, formatWeekRange, getWeekDates, scheduleTimeZone, scheduleToday, type PastRun, type ScheduleTrigger } from '@/data/scheduler'
import { useAgentNames } from '@/hooks/useAgentNames'
import { useLoadedData } from '@/hooks/useRunData'
import { useTriggers } from '@/hooks/useTriggers'
import { formatZonedIsoDate } from '@/lib/schedule'
import { routePaths } from '@/routes'
import { RunErrorNotice } from '@/pages/agent-run/RunErrorNotice'
import { CalendarGrid } from './scheduler/CalendarGrid'
import { ScheduleList } from './scheduler/ScheduleList'
import { ScheduleRulesPanel } from './scheduler/ScheduleRulesPanel'
import { ScheduleToolbar, type ScheduleViewMode } from './scheduler/ScheduleToolbar'
import { TriggersPanel } from './scheduler/TriggersPanel'
import { getRunHistoryWindow, mockEventTriggers, sortLikeMockup, toPastRuns, toScheduleTrigger } from './scheduler/schedulerViewModel'

/** Dark promo card pointing to moving schedules onto a server so they run with the computer off. */
function RemoteRunnerPromo() {
  return (
    <Link to={routePaths.settings} className="flex items-center gap-3 rounded-[14px] bg-ink px-4 py-3.5 no-underline !text-white hover:bg-ink-2">
      <StrokeIcon size={20} className="shrink-0 text-teal">
        <path d="M7 18a4 4 0 0 1-.6-8 6 6 0 0 1 11.6 1.5A3.5 3.5 0 0 1 17.5 18z" />
      </StrokeIcon>
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">Runs even when the computer is off</span>
        <span className="text-[13px] text-line-strong">Move schedules to your own server or VPS, free</span>
      </span>
    </Link>
  )
}

/** The calendar's zone: the first schedule's, else this computer's (the preview is pinned to the design's). */
function resolveTimezone(triggers: Trigger[]): string {
  if (triggers[0]) return triggers[0].timezone
  if (!isDesktopApp()) return scheduleTimeZone
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * Backend triggers as calendar triggers, plus (in the browser preview) the mockup's event and
 * webhook triggers, which the backend cannot hold yet and which toggle locally.
 */
function useSchedulerTriggers() {
  const getAgentName = useAgentNames()
  const { triggers, error, toggleError, setEnabled } = useTriggers()
  const [mockTriggers, setMockTriggers] = useState(() => (isDesktopApp() ? [] : mockEventTriggers))

  const backendTriggers = triggers.map((trigger) => toScheduleTrigger(trigger, getAgentName(trigger.agentId)))
  const scheduleTriggers: ScheduleTrigger[] = sortLikeMockup([...backendTriggers, ...mockTriggers])

  const toggleTrigger = (triggerId: string) => {
    const backendTrigger = triggers.find((trigger) => trigger.id === triggerId)
    if (backendTrigger) {
      void setEnabled(triggerId, !backendTrigger.enabled)
      return
    }
    setMockTriggers((current) => current.map((trigger) => (trigger.id === triggerId ? { ...trigger, isEnabled: !trigger.isEnabled } : trigger)))
  }

  return { triggers, scheduleTriggers, timezone: resolveTimezone(triggers), error: error ?? toggleError, toggleTrigger }
}

/** Runs the schedules started on `weekDates`, placed on their trigger rows. */
function usePastRuns(weekDates: string[], triggers: Trigger[], timezone: string): { pastRuns: PastRun[]; error: Error | null } {
  const { since, until } = getRunHistoryWindow(weekDates)
  const { data: runs, error } = useLoadedData(() => listScheduledRuns(since, until), [since, until])
  const pastRuns = toPastRuns(runs ?? [], triggers, timezone).filter((pastRun) => weekDates.includes(pastRun.date))
  return { pastRuns, error }
}

/**
 * Screen 10 · Scheduler.
 * A week calendar of every scheduled run with the trigger list and global schedule rules alongside.
 * Triggers come from `listTriggers` and their switches call `setTriggerEnabled`; planned runs are
 * drawn from each trigger's cron expression and past runs from `listScheduledRuns`. The browser
 * preview is pinned to the design's week.
 */
export function SchedulerPage() {
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('week')
  const [weekOffset, setWeekOffset] = useState(0)
  const { triggers, scheduleTriggers, timezone, error, toggleTrigger } = useSchedulerTriggers()

  const todayIsoDate = isDesktopApp() ? formatZonedIsoDate(new Date(), timezone) : scheduleToday
  const weekDates = getWeekDates(todayIsoDate, weekOffset)
  const { pastRuns, error: historyError } = usePastRuns(weekDates, triggers, timezone)
  const visibleDates = viewMode === 'day' ? [weekDates.includes(todayIsoDate) ? todayIsoDate : weekDates[0]] : weekDates
  const entries = buildCalendarEntries({ dates: visibleDates, triggers: scheduleTriggers, todayIsoDate, runs: pastRuns })
  const viewLabel = viewMode === 'day' ? 'Day view' : viewMode === 'week' ? 'Week view' : 'List view'

  return (
    <AppShell activeNav="schedule" agents={{ kind: 'list' }}>
      <PageFrame layout="wrap">
        <ScheduleToolbar
          subtitle={`${formatWeekRange(weekDates)} · ${timezone}`}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onShiftWeek={(direction) => setWeekOffset((currentOffset) => currentOffset + direction)}
        />
        {error && (
          <div className="flex-[1_1_100%]">
            <RunErrorNotice title="Could not update the schedules" error={error} />
          </div>
        )}
        {historyError && (
          <div className="flex-[1_1_100%]">
            <RunErrorNotice title="Could not load past runs" error={historyError} />
          </div>
        )}
        {viewMode === 'list' ? (
          <ScheduleList entries={entries} label={viewLabel} />
        ) : (
          <CalendarGrid dates={visibleDates} entries={entries} todayIsoDate={todayIsoDate} label={viewLabel} />
        )}
        <aside aria-label="Triggers and rules" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <TriggersPanel triggers={scheduleTriggers} onToggleTrigger={toggleTrigger} />
          <ScheduleRulesPanel />
          {/* Running schedules on a server does not exist yet, so the desktop app does not advertise it. */}
          {!isDesktopApp() && <RemoteRunnerPromo />}
        </aside>
      </PageFrame>
    </AppShell>
  )
}
