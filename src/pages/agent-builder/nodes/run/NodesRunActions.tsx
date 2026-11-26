import { useId } from 'react'
import type { GraphProblem } from '@/api/agentGraphTypes'
import { joinClassNames, StrokeIcon } from '@/components/ui'
import { foldingLabelClassNames } from '../NodesToolbar'
import type { TestBlock } from '../problems/problemDisplay'
import { messages } from '@/i18n'

const actionButtonClassNames =
  'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle disabled:cursor-default disabled:opacity-50 @max-[46rem]:px-2'

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

/** Why Test can't be pressed now, for its tooltip and screen readers; null when it can. */
export function describeTestButtonState(testBlock: TestBlock | null, isStarting: boolean, isRunActive: boolean): string | null {
  if (isStarting) return messages().nodes.startingTheTest
  if (isRunActive) return messages().nodes.aTestIsRunningFollowIt
  return testBlock?.reason ?? null
}

/**
 * The Nodes toolbar's Add note, Validate (with the number of problems, spec 37) and Test
 * (off with the reason while the graph has errors or the builder works; spec 45). It is
 * the only Test in the Nodes view: the builder header leaves its own out there.
 */
export function NodesRunActions({ problems, isValidating, onValidate, onAddNote, canAddNote, testBlock, isStarting, isRunActive, onTest }: NodesRunActionsProps) {
  const reasonId = useId()
  const errorCount = problems.filter((problem) => problem.severity === 'error').length
  const testBlockReason = describeTestButtonState(testBlock, isStarting, isRunActive)
  return (
    <>
      <button type="button" onClick={onAddNote} disabled={!canAddNote} title={messages().nodes.addNote} className={actionButtonClassNames}>
        <StrokeIcon size={14}>
          <path d="M5 4h14v10l-6 6H5zM13 20v-6h6" />
        </StrokeIcon>
        <span className={foldingLabelClassNames}>{messages().nodes.addNote}</span>
      </button>
      <button type="button" onClick={onValidate} disabled={isValidating} title={messages().nodes.validate} className={actionButtonClassNames}>
        <StrokeIcon size={14}>
          <path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6zM8.5 12l2.5 2.5L15.5 10" />
        </StrokeIcon>
        <span className={foldingLabelClassNames}>{isValidating ? messages().nodes.checking : messages().nodes.validate}</span>
        {errorCount > 0 && (
          <span aria-label={messages().nodes.errorcountProblems(errorCount)} className="rounded-full bg-danger px-1.5 text-[11px] leading-[18px] font-semibold text-white">
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
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 4.5v15l13-7.5z" />
        </svg>
        {isStarting ? messages().nodes.starting : isRunActive ? messages().nodes.testing : messages().nodes.test}
      </button>
      {testBlockReason && (
        <span id={reasonId} className="sr-only">
          {testBlockReason}
        </span>
      )}
    </>
  )
}
