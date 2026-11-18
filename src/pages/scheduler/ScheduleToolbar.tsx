import { useNavigate } from 'react-router-dom'
import { Button, Icon, StrokeIcon, joinClassNames } from '@/components/ui'
import { routePaths } from '@/routes'

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
  const navigate = useNavigate()
  return (
    <div className="flex flex-[1_1_100%] flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.5px]">Schedule</h1>
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
        <Button onClick={() => navigate(routePaths.scheduleAgent)}>
          <Icon name="plus" size={16} />
          New trigger
        </Button>
      </div>
    </div>
  )
}
