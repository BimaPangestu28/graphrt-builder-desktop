import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { splitPaneColumnClassName, splitPaneScrollClassName } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { useFollowNewContent } from '@/hooks/useFollowNewContent'
import { agentPath, routePaths } from '@/routes'
import { messages } from '@/i18n'

/**
 * Two-column workspace used while testing an agent (screens 06 and 07):
 * the "Build with chat" column on the left and the grey "Run" column on the right.
 * Both columns wrap under each other on narrow windows.
 */
export function RunWorkspace({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full w-full flex-wrap lg:h-full lg:flex-nowrap">{children}</div>
}

/** Left column: chat with the builder. */
export function BuildChatPanel({ children }: { children: ReactNode }) {
  const chatBodyRef = useFollowNewContent()
  return (
    <section aria-label={messages().agentRun.chat} className={`box-border flex min-w-0 flex-[1_1_380px] flex-col border-r border-line bg-surface ${splitPaneColumnClassName}`}>
      <header className="box-border flex h-16 items-center border-b border-line px-6">
        <span className="font-semibold">{messages().agentRun.buildWithChat}</span>
      </header>
      <div ref={chatBodyRef} className={`flex flex-col gap-5 p-6 ${splitPaneScrollClassName}`}>
        {children}
      </div>
    </section>
  )
}

/** The user's own chat message, right-aligned in a grey bubble. */
export function UserChatBubble({ children }: { children: ReactNode }) {
  return <div className="box-content max-w-[85%] self-end rounded-[16px_16px_4px_16px] bg-canvas px-4 py-3 leading-normal">{children}</div>
}

/** A plain reply from the builder. */
export function BuilderReply({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-[92%] leading-[1.6]">{children}</p>
}

type RunViewTab = 'steps' | 'runs' | 'source'

/** Tab targets for the agent in the route (`/agents/:agentId/...`); Home when there is none. */
function buildRunViewTabs(agentId: string | undefined): Array<{ key: RunViewTab; label: string; path: string }> {
  return [
    { key: 'steps', label: messages().agentRun.steps, path: agentId ? agentPath('builder', agentId) : routePaths.home },
    { key: 'runs', label: messages().agentRun.runs, path: routePaths.runs },
    { key: 'source', label: messages().agentRun.source, path: agentId ? agentPath('versionHistory', agentId) : routePaths.home },
  ]
}

/**
 * Steps / Runs / Source segmented control. "Runs" is the current view on these screens;
 * the other two jump to the step editor and the version history.
 */
function RunViewTabs() {
  const navigate = useNavigate()
  const runViewTabs = buildRunViewTabs(useParams().agentId)
  return (
    <div role="group" aria-label={messages().agentRun.agentView} className="flex gap-1 rounded-[10px] bg-selected p-1">
      {runViewTabs.map((tab) => {
        const isCurrent = tab.key === 'runs'
        return (
          <button
            key={tab.key}
            type="button"
            aria-pressed={isCurrent}
            onClick={() => !isCurrent && navigate(tab.path)}
            className={joinClassNames(
              'h-8 cursor-pointer rounded-[7px] border-0 px-3.5 text-[13px]',
              isCurrent ? 'bg-surface font-semibold text-ink' : 'bg-transparent font-medium text-body hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/** Right column: view tabs and a page-specific action in the header, run details below. */
export function RunPanel({ headerAction, children }: { headerAction: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={messages().agentRun.run} className={`box-border flex min-w-0 flex-[1_1_440px] flex-col bg-subtle ${splitPaneColumnClassName}`}>
      <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
        <RunViewTabs />
        {headerAction}
      </header>
      <div className={`flex flex-col gap-5 p-6 ${splitPaneScrollClassName}`}>{children}</div>
    </section>
  )
}

/** Small white action in the run header (Stop run, Export CSV). */
export const runHeaderActionClassNames =
  'inline-flex h-9 cursor-pointer items-center rounded-lg border border-line-strong bg-surface px-3.5 text-[13px] font-medium !text-ink no-underline hover:bg-subtle'

/** "Test run" title row with a meta line and a status pill on the right. */
export function RunTitleRow({ meta, status }: { meta: string; status: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[22px] font-semibold">{messages().agentRun.testRun}</h1>
        <span className="text-body">{meta}</span>
      </div>
      {status}
    </div>
  )
}
