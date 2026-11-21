import { useId } from 'react'
import type { GraphProblem } from '@/api/agentGraphTypes'
import { joinClassNames } from '@/components/ui'
import type { TestBlock } from '../problems/problemDisplay'

const actionButtonClassNames =
  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle disabled:cursor-default disabled:opacity-50'

interface NodesRunActionsProps {
  problems: GraphProblem[]
  isValidating: boolean
  onValidate: () => void
  onAddNote: () => void
  canAddNote: boolean
  /** Why Test is off or needs something first; null when it can start. */
  testBlock: TestBlock | null
  isStarting: boolean
  isRunActive: boolean
  onTest: () => void
}

/**
 * The Nodes toolbar's Add note, Validate (with the number of problems, spec 37) and Test
 * (off with the reason while the graph has errors or the builder works; spec 45).
 */
export function NodesRunActions({ problems, isValidating, onValidate, onAddNote, canAddNote, testBlock, isStarting, isRunActive, onTest }: NodesRunActionsProps) {
  const reasonId = useId()
  const errorCount = problems.filter((problem) => problem.severity === 'error').length
  const testBlockReason = testBlock?.reason ?? null
  return (
    <>
      <button type="button" onClick={onAddNote} disabled={!canAddNote} className={actionButtonClassNames}>
        Add note
      </button>
      <button type="button" onClick={onValidate} disabled={isValidating} className={actionButtonClassNames}>
        {isValidating ? 'Checking…' : 'Validate'}
        {errorCount > 0 && (
          <span aria-label={`${errorCount} problems`} className="rounded-full bg-danger px-1.5 text-[11px] leading-[18px] font-semibold text-white">
            {errorCount}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onTest}
        disabled={Boolean(testBlock?.isBlocking) || isStarting || isRunActive}
        aria-describedby={testBlockReason ? reasonId : undefined}
        title={testBlockReason ?? undefined}
        className={joinClassNames(actionButtonClassNames, 'border-ink bg-ink !text-white hover:bg-ink-2')}
      >
        {isStarting ? 'Starting…' : isRunActive ? 'Testing…' : 'Test'}
      </button>
      {testBlockReason && (
        <span id={reasonId} className="sr-only">
          {testBlockReason}
        </span>
      )}
    </>
  )
}
