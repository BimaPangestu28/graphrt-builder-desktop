import { Link } from 'react-router-dom'
import { LinkButton, LogoMark, StatusDot, joinClassNames } from '@/components/ui'
import { menuBarAttentionItems, nextScheduledRun, runningAgent, type MenuBarAttentionItem } from '@/data/menuBar'
import { routePaths } from '@/routes'

const attentionToneClassNames: Record<MenuBarAttentionItem['tone'], string> = {
  amber: 'bg-amber-tint border-amber-line-2',
  danger: 'bg-danger-tint border-danger-line',
}

function MenuBarAttentionRow({ item }: { item: MenuBarAttentionItem }) {
  return (
    <li className={joinClassNames('flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5', attentionToneClassNames[item.tone])}>
      <span className="flex flex-auto flex-col gap-0.5">
        <span className="font-medium">{item.title}</span>
        <span className="text-[12px] text-body">{item.detail}</span>
      </span>
      <LinkButton
        to={item.actionPath}
        variant={item.isPrimaryAction ? 'primary' : 'secondary'}
        size="sm"
        className={joinClassNames('!h-[30px] !px-2.5 !text-[12px]', item.isPrimaryAction ? '!text-white' : '!text-ink')}
      >
        {item.actionLabel}
      </LinkButton>
    </li>
  )
}

function RunningNowProgress() {
  const percentComplete = Math.round((runningAgent.completedCount / runningAgent.totalCount) * 100)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex justify-between">
        <span>{runningAgent.name}</span>
        <span className="text-[12px] text-body">
          {runningAgent.completedCount} of {runningAgent.totalCount}
        </span>
      </span>
      <span
        role="progressbar"
        aria-label={`${runningAgent.name} progress`}
        aria-valuemin={0}
        aria-valuemax={runningAgent.totalCount}
        aria-valuenow={runningAgent.completedCount}
        className="block h-1.5 overflow-hidden rounded-full bg-selected"
      >
        <span className="block h-full bg-brand" style={{ width: `${percentComplete}%` }} />
      </span>
    </div>
  )
}

const footerItemClassNames = 'block w-full cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-[14px] no-underline hover:bg-canvas'

interface MenuBarPopoverProps {
  areAgentsPaused: boolean
  onTogglePause: () => void
}

/** The dropdown that opens from the graphrt icon in the macOS menu bar. */
export function MenuBarPopover({ areAgentsPaused, onTogglePause }: MenuBarPopoverProps) {
  return (
    <section aria-label="graphrt menu" className="box-border w-[380px] overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_20px_48px_rgba(0,0,0,0.16)]">
      <header className="flex items-center gap-2.5 border-b border-chip px-4 py-3.5">
        <LogoMark size={24} />
        <span className="flex-auto font-semibold">graphrt</span>
        <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <StatusDot tone={areAgentsPaused ? 'paused' : 'ok'} />
          {areAgentsPaused ? 'Paused for 1 hour' : 'Runner online'}
        </span>
      </header>

      <div className="flex flex-col gap-2 px-4 py-3">
        <span className="text-[12px] font-semibold text-amber-strong">Needs you · {menuBarAttentionItems.length}</span>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {menuBarAttentionItems.map((item) => (
            <MenuBarAttentionRow key={item.id} item={item} />
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-1 pb-3">
        <span className="text-[12px] font-semibold text-muted">Running now</span>
        <RunningNowProgress />
        <span className="mt-1 text-[12px] font-semibold text-muted">Next</span>
        <span className="flex justify-between">
          <span>{nextScheduledRun.agentName}</span>
          <span className="text-[12px] text-body">{nextScheduledRun.startsAt}</span>
        </span>
      </div>

      <footer className="border-t border-chip p-1.5">
        <Link to={routePaths.home} className={`${footerItemClassNames} !text-ink`}>
          Open graphrt
        </Link>
        <button type="button" aria-pressed={areAgentsPaused} onClick={onTogglePause} className={`${footerItemClassNames} text-ink`}>
          {areAgentsPaused ? 'Resume all agents' : 'Pause all agents for 1 hour'}
        </button>
        <Link to={routePaths.screenIndex} className={`${footerItemClassNames} !text-ink-2`}>
          Quit
        </Link>
      </footer>
    </section>
  )
}
