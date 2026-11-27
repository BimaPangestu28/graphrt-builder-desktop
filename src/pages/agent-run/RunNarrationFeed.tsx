import { useEffect, useRef } from 'react'
import { ErrorHelpNotice } from '@/components/errors/ErrorHelpNotice'
import { joinClassNames } from '@/components/ui'
import { explainErrorKind } from '@/lib/errorHelp'
import type { NarrationLine, NarrationTone } from './runNarration'
import { messages } from '@/i18n'

const toneClassNames: Record<NarrationTone, string> = {
  neutral: 'text-ink',
  ok: 'font-medium text-ok-strong',
  danger: 'font-medium text-danger',
  amber: 'font-medium text-amber-strong',
}

/** How close to the bottom (px) still counts as "following" the feed. */
const followThresholdPx = 24

function NarrationText({ line, onOpenApproval }: { line: NarrationLine; onOpenApproval: () => void }) {
  if (!line.isApprovalLink) return <>{line.text}</>
  return (
    <button type="button" onClick={onOpenApproval} className="cursor-pointer border-0 bg-transparent p-0 text-left font-medium text-amber-strong underline">
      {line.text}
    </button>
  )
}

/** Under a failure line: what to do next and the original message for a known kind, else the raw text folded. */
function FailureDetails({ line, rawError }: { line: NarrationLine; rawError: string }) {
  const help = explainErrorKind(line.errorType)
  if (help) return <ErrorHelpNotice help={help} detail={rawError} pluginName={line.pluginName} showsHeadline={false} className="max-w-[92%]" />
  return (
    <details className="text-[12px] text-body">
      <summary className="cursor-pointer">{messages().agentRun.technicalDetails}</summary>
      <pre className="m-0 mt-1 whitespace-pre-wrap break-words font-mono">{rawError}</pre>
    </details>
  )
}

interface RunNarrationFeedProps {
  lines: NarrationLine[]
  /** Shown before the first line arrives. */
  placeholder: string
  /** Moves to the approval card (scroll and focus). */
  onOpenApproval: () => void
}

/**
 * The chat column's live feed on the Test run screen: plain-language updates, newest at the
 * bottom. It follows new lines unless the user scrolled up to read older ones.
 */
export function RunNarrationFeed({ lines, placeholder, onOpenApproval }: RunNarrationFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null)
  const isFollowingRef = useRef(true)
  const contentSignature = lines.map((line) => line.text).join('\n')

  useEffect(() => {
    const feed = feedRef.current
    if (feed && isFollowingRef.current) feed.scrollTop = feed.scrollHeight
  }, [contentSignature])

  const rememberScrollPosition = () => {
    const feed = feedRef.current
    if (feed) isFollowingRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight <= followThresholdPx
  }

  return (
    <div ref={feedRef} role="log" aria-label={messages().agentRun.runUpdates} onScroll={rememberScrollPosition} className="flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto">
      {lines.length === 0 && <p className="m-0 leading-[1.6] text-body">{placeholder}</p>}
      {lines.map((line) => (
        <div key={line.key} className="flex flex-col gap-1">
          <p className={joinClassNames('m-0 max-w-[92%] leading-[1.6]', toneClassNames[line.tone])}>
            <NarrationText line={line} onOpenApproval={onOpenApproval} />
          </p>
          {line.rawError && <FailureDetails line={line} rawError={line.rawError} />}
        </div>
      ))}
    </div>
  )
}
