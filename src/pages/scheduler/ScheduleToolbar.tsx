import { useNavigate } from 'react-router-dom'
import { Button, Icon, StrokeIcon, joinClassNames } from '@/components/ui'
import { useAgents } from '@/hooks/useAgents'
import { pageTitleClassName } from '@/components/layout'
import { agentPath, routePaths } from '@/routes'

export type ScheduleViewMode = 'day' | 'week' | 'list'

const viewModeOptions: Array<{ mode: ScheduleViewMode; label: string }> = [
  { mode: 'day', label: 'Day' },
  { mode: 'week', label: 'Week' },
  { mode: 'list', label: 'List' },
]

interface ScheduleToolbarProps {
  subtitle: string
  viewMode: ScheduleViewMode
  onViewModeChange: (viewMode: ScheduleViewMode) => void
  onShiftWeek: (direction: -1 | 1) => void
}

const squareIconButtonClassNames =
  'flex size-10 cursor-pointer items-center justify-center rounded-[10px] border border-line-strong bg-surface text-ink hover:bg-subtle'

/** Page title with the Day / Week / List switch, week arrows and the "New trigger" action. */
export function ScheduleToolbar({ subtitle, viewMode, onViewModeChange, onShiftWeek }: ScheduleToolbarProps) {
  return (
    <div className="flex flex-[1_1_100%] flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className={pageTitleClassName}>Schedule</h1>
        <span className="text-body">{subtitle}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="flex gap-1 rounded-[10px] bg-selected p-1">
          {viewModeOptions.map((option) => {
            const isSelected = option.mode === viewMode
            return (
              <button
                key={option.mode}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onViewModeChange(option.mode)}
                className={joinClassNames(
                  'h-8 cursor-pointer rounded-[7px] border-0 px-3.5 text-[13px]',
                  isSelected ? 'bg-surface font-semibold text-ink' : 'bg-transparent font-medium text-body',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        <button type="button" aria-label="Previous week" onClick={() => onShiftWeek(-1)} className={squareIconButtonClassNames}>
          <StrokeIcon size={16}>
            <path d="M15 5l-7 7 7 7" />
          </StrokeIcon>
        </button>
        <button type="button" aria-label="Next week" onClick={() => onShiftWeek(1)} className={squareIconButtonClassNames}>
          <StrokeIcon size={16}>
            <path d="M9 5l7 7-7 7" />
          </StrokeIcon>
        </button>
        <NewTriggerAction />
      </div>
    </div>
  )
}

/**
 * "New trigger" for a real agent: with one agent it opens that agent's schedule dialog,
 * with several it asks which agent, and with none it goes to New agent.
 */
function NewTriggerAction() {
  const navigate = useNavigate()
  const { data: agents } = useAgents()
  if (!agents || agents.length <= 1) {
    const target = agents?.[0] ? agentPath('scheduleAgent', agents[0].id) : routePaths.newAgent
    return (
      <Button onClick={() => navigate(target)}>
        <Icon name="plus" size={16} />
        New trigger
      </Button>
    )
  }
  return (
    <label className="flex h-10 items-center gap-2 rounded-[9px] bg-ink px-3 text-[14px] font-semibold text-white">
      <Icon name="plus" size={16} />
      <span className="sr-only">New trigger for</span>
      <select
        value=""
        onChange={(event) => event.target.value && navigate(agentPath('scheduleAgent', event.target.value))}
        className="cursor-pointer border-0 bg-transparent text-[14px] font-semibold text-white outline-none"
      >
        <option value="" disabled>
          New trigger for…
        </option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id} className="text-ink">
            {agent.name}
          </option>
        ))}
      </select>
    </label>
  )
}
