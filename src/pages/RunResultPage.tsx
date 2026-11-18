import { Link, useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { hiddenPlaceCount, testRunPlaces, testRunStats } from '@/data/testRun'
import { routePaths } from '@/routes'
import { buildPlacesCsvHref } from '@/pages/agent-run/placesCsv'
import { RunPlacesTable, RunStatTiles } from '@/pages/agent-run/RunResultDetails'
import { BuildChatPanel, BuilderReply, RunPanel, RunTitleRow, RunWorkspace, UserChatBubble, runHeaderActionClassNames } from '@/pages/agent-run/RunWorkspace'
import { StatusPill } from '@/pages/agent-run/StatusPill'

/** "What next?" card offering a full run (goes to batch review) or a schedule (08). */
function WhatNextCard() {
  const navigate = useNavigate()
  return (
    <div className="flex box-content max-w-[92%] flex-col gap-3 rounded-[14px] border border-line p-4">
      <span className="font-semibold">What next?</span>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => navigate(routePaths.batchApproval)}
          className="h-11 cursor-pointer rounded-[10px] border border-line-strong bg-surface px-3.5 text-left text-[14px] font-medium text-ink hover:bg-subtle"
        >
          Run now for the other 17 places
        </button>
        <button
          type="button"
          onClick={() => navigate(routePaths.scheduleAgent)}
          className="h-11 cursor-pointer rounded-[9px] border-0 bg-ink px-3.5 text-left text-[14px] font-semibold text-white hover:bg-ink-2"
        >
          Run it every weekday on new places
        </button>
      </div>
    </div>
  )
}

/**
 * Screen 07 · Test run result.
 * The approved test message was delivered. Shows run stats and the places table,
 * offers a CSV export, and asks what to do next: run the rest now or put it on a schedule.
 */
export function RunResultPage() {
  return (
    <AppShell agents={{ kind: 'draft', name: 'Maps leads to WhatsApp', status: 'Tested · not scheduled' }} runnerStatus="Online · OpenAI connected">
      <RunWorkspace>
        <BuildChatPanel>
          <UserChatBubble>Test with 1 place</UserChatBubble>
          <BuilderReply>The message reached [PLACE NAME] at 13:04. Everything worked</BuilderReply>
          <WhatNextCard />
        </BuildChatPanel>

        <RunPanel
          headerAction={
            <a href={buildPlacesCsvHref(testRunPlaces)} download="maps-leads-test-run.csv" className={runHeaderActionClassNames}>
              Export CSV
            </a>
          }
        >
          <RunTitleRow
            meta="Today 13:03 · on this Mac"
            status={
              <StatusPill tone="ok" size="title">
                Succeeded
              </StatusPill>
            }
          />
          <RunStatTiles stats={testRunStats} />
          <RunPlacesTable places={testRunPlaces} hiddenPlaceCount={hiddenPlaceCount} />
          <Link to={routePaths.runs} className="self-start font-medium">
            Open the step by step log
          </Link>
        </RunPanel>
      </RunWorkspace>
    </AppShell>
  )
}
