import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { StrokeIcon } from '@/components/ui'
import {
  buildCalendarEntries,
  formatWeekRange,
  getWeekDates,
  initialScheduleTriggers,
  scheduleTimeZone,
  scheduleToday,
  type ScheduleTrigger,
} from '@/data/scheduler'
import { routePaths } from '@/routes'
import { CalendarGrid } from './scheduler/CalendarGrid'
import { ScheduleList } from './scheduler/ScheduleList'
import { ScheduleRulesPanel } from './scheduler/ScheduleRulesPanel'
import { ScheduleToolbar, type ScheduleViewMode } from './scheduler/ScheduleToolbar'
import { TriggersPanel } from './scheduler/TriggersPanel'

/** Dark promo card pointing to moving schedules onto a server so they run with the Mac off. */
function RemoteRunnerPromo() {
  return (
    <Link to={routePaths.settings} className="flex items-center gap-3 rounded-[14px] bg-ink px-4 py-3.5 no-underline !text-white hover:bg-ink-2">
      <StrokeIcon size={20} className="shrink-0 text-teal">
        <path d="M7 18a4 4 0 0 1-.6-8 6 6 0 0 1 11.6 1.5A3.5 3.5 0 0 1 17.5 18z" />
      </StrokeIcon>
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">Runs even when the Mac is off</span>
        <span className="text-[13px] text-line-strong">Move schedules to your own server or VPS, free</span>
      </span>
    </Link>
  )
}

function toggleTriggerById(triggers: ScheduleTrigger[], triggerId: string): ScheduleTrigger[] {
  return triggers.map((trigger) => (trigger.id === triggerId ? { ...trigger, isEnabled: !trigger.isEnabled } : trigger))
}

/**
 * Screen 10 · Scheduler.
 * A week calendar of every scheduled run (done, failed, waiting on you, planned, paused),
 * with the trigger list and global schedule rules alongside.
 * The Day / Week / List switch, week arrows and trigger switches all update the calendar.
 */
export function SchedulerPage() {
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('week')
  const [weekOffset, setWeekOffset] = useState(0)
  const [triggers, setTriggers] = useState(initialScheduleTriggers)

  const weekDates = getWeekDates(scheduleToday, weekOffset)
  const visibleDates = viewMode === 'day' ? [weekDates.includes(scheduleToday) ? scheduleToday : weekDates[0]] : weekDates
  const entries = buildCalendarEntries({ dates: visibleDates, triggers, todayIsoDate: scheduleToday })
  const viewLabel = viewMode === 'day' ? 'Day view' : viewMode === 'week' ? 'Week view' : 'List view'

  return (
    <AppShell activeNav="schedule" agents={{ kind: 'list' }} mainClassName="box-border flex flex-wrap content-start gap-6 p-8">
      <ScheduleToolbar
        subtitle={`${formatWeekRange(weekDates)} · ${scheduleTimeZone}`}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onShiftWeek={(direction) => setWeekOffset((currentOffset) => currentOffset + direction)}
      />
      {viewMode === 'list' ? (
        <ScheduleList entries={entries} label={viewLabel} />
      ) : (
        <CalendarGrid dates={visibleDates} entries={entries} todayIsoDate={scheduleToday} label={viewLabel} />
      )}
      <aside aria-label="Triggers and rules" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
        <TriggersPanel triggers={triggers} onToggleTrigger={(triggerId) => setTriggers((current) => toggleTriggerById(current, triggerId))} />
        <ScheduleRulesPanel />
        <RemoteRunnerPromo />
      </aside>
    </AppShell>
  )
}
