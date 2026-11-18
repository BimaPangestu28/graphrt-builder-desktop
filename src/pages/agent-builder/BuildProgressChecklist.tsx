import { StrokeIcon, VisuallyHidden, joinClassNames } from '@/components/ui'

type BuildItemState = 'done' | 'running' | 'pending'

function getBuildItemState(itemIndex: number, runningItemIndex: number): BuildItemState {
  if (itemIndex < runningItemIndex) return 'done'
  if (itemIndex === runningItemIndex) return 'running'
  return 'pending'
}

const stateLabels: Record<BuildItemState, string> = { done: 'Done', running: 'In progress', pending: 'Not started' }

/** 20px circle on the left of each checklist line: green check, spinning ring, or empty ring. */
function BuildItemIndicator({ state }: { state: BuildItemState }) {
  if (state === 'done') {
    return (
      <span className="flex size-5 flex-[0_0_20px] items-center justify-center rounded-full bg-ok-soft text-ok-strong">
        <StrokeIcon size={12} strokeWidth={3}>
          <path d="M5 12.5 10 17 19 7" />
        </StrokeIcon>
      </span>
    )
  }
  if (state === 'running') {
    return <span className="box-border size-5 flex-[0_0_20px] animate-spin rounded-full border-2 border-brand border-r-brand-line motion-reduce:animate-none" />
  }
  return <span className="box-border size-5 flex-[0_0_20px] rounded-full border-2 border-line-strong" />
}

/** One checklist line: its title, plus what to show once done or while running. */
export interface BuildChecklistItem {
  title: string
  detail?: string
  runningDetail?: string
  /** Quiet live activity while this item runs ("Writing… 412 tokens"); hidden from screen readers so it is not read on every update. */
  activity?: string
}

interface BuildProgressChecklistProps {
  items: BuildChecklistItem[]
  /** Index of the item currently running; equal to `items.length` once everything is done. */
  runningItemIndex: number
}

/** The "Building your agent" card in the chat column of screen 03. */
export function BuildProgressChecklist({ items, runningItemIndex }: BuildProgressChecklistProps) {
  return (
    <div className="flex box-content max-w-[92%] flex-col gap-3.5 rounded-[14px] border border-line p-[18px]">
      <span className="font-semibold">{runningItemIndex >= items.length ? 'Your agent is ready' : 'Building your agent'}</span>
      <ol aria-live="polite" className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((item, itemIndex) => {
          const state = getBuildItemState(itemIndex, runningItemIndex)
          const detail = state === 'running' ? item.runningDetail : state === 'done' ? item.detail : undefined
          return (
            <li key={item.title} className={joinClassNames('flex items-start gap-2.5', state === 'pending' && 'text-muted')}>
              <BuildItemIndicator state={state} />
              <span className="flex flex-col gap-0.5">
                <span className={state === 'running' ? 'font-semibold' : undefined}>
                  {item.title}
                  <VisuallyHidden>{`, ${stateLabels[state]}`}</VisuallyHidden>
                </span>
                {detail && <span className="text-[13px] text-body">{detail}</span>}
                {state === 'running' && item.activity && (
                  <span aria-hidden="true" className="text-[12px] text-muted tabular-nums">
                    {item.activity}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
