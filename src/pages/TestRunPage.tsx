import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { LinkButton, StrokeIcon } from '@/components/ui'
import { pendingApproval, testRunSteps } from '@/data/testRun'
import { routePaths } from '@/routes'
import { ApprovalCard } from '@/pages/agent-run/ApprovalCard'
import { BuildChatPanel, BuilderReply, RunPanel, RunTitleRow, RunWorkspace, UserChatBubble, runHeaderActionClassNames } from '@/pages/agent-run/RunWorkspace'
import { StatusPill } from '@/pages/agent-run/StatusPill'
import { StepProgressList } from '@/pages/agent-run/StepProgressList'

function WhatsAppConnectedNotice() {
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] bg-ok-tint px-3.5 py-2.5 text-ok-strong">
      <StrokeIcon size={16} strokeWidth={2.5}>
        <path d="M5 12.5 10 17 19 7" />
      </StrokeIcon>
      WhatsApp connected as +62 8•• •••• 1204
    </div>
  )
}

/** Shown in place of the approval card after the user skips the only test place. */
function SkippedPlaceNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <section aria-label="Place skipped" className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[18px] font-semibold">Skipped this place</h2>
        <span className="text-[13px] text-body">Nothing was sent. The test ends here because it only used 1 place</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="h-10 cursor-pointer rounded-[9px] border-0 bg-ink px-[18px] text-[14px] font-semibold text-white hover:bg-ink-2"
        >
          Test again
        </button>
        <LinkButton to={routePaths.builder} variant="secondary" className="!rounded-[10px] !font-medium !text-ink">
          Back to steps
        </LinkButton>
      </div>
    </section>
  )
}

/**
 * Screen 06 · Test run and approval.
 * The first test of "Maps leads to WhatsApp" has run three steps and paused on "Ask me before sending".
 * The user can edit the drafted message and approve it (goes to the run result, 07),
 * skip the place (ends the test), or stop the run (back to the step editor).
 */
export function TestRunPage() {
  const navigate = useNavigate()
  const [draftMessage, setDraftMessage] = useState(pendingApproval.draftMessage)
  const [isPlaceSkipped, setIsPlaceSkipped] = useState(false)

  const restartTest = () => {
    setDraftMessage(pendingApproval.draftMessage)
    setIsPlaceSkipped(false)
  }

  return (
    <AppShell
      agents={{ kind: 'draft', name: 'Maps leads to WhatsApp', status: 'Testing · waiting for you', statusTone: 'amber' }}
      runnerStatus="Online · OpenAI connected"
    >
      <RunWorkspace>
        <BuildChatPanel>
          <WhatsAppConnectedNotice />
          <UserChatBubble>Test with 1 place</UserChatBubble>
          <BuilderReply>
            Found 18 cafes with a phone number. For this test I am only using the first one. The message is ready and waiting for your OK on the right
          </BuilderReply>
        </BuildChatPanel>

        <RunPanel
          headerAction={
            <button type="button" onClick={() => navigate(routePaths.builder)} className={runHeaderActionClassNames}>
              Stop run
            </button>
          }
        >
          <RunTitleRow
            meta="1 of 18 places · started 14s ago"
            status={
              isPlaceSkipped ? (
                <StatusPill tone="neutral" size="title">
                  Ended
                </StatusPill>
              ) : (
                <StatusPill tone="amber" size="title">
                  Waiting for you
                </StatusPill>
              )
            }
          />
          <StepProgressList steps={testRunSteps} />
          {isPlaceSkipped ? (
            <SkippedPlaceNotice onRetry={restartTest} />
          ) : (
            <ApprovalCard
              recipientSummary={pendingApproval.recipientSummary}
              message={draftMessage}
              onMessageChange={setDraftMessage}
              onApprove={() => navigate(routePaths.runResult, { state: { sentMessage: draftMessage } })}
              onSkip={() => setIsPlaceSkipped(true)}
            />
          )}
        </RunPanel>
      </RunWorkspace>
    </AppShell>
  )
}
