import { joinClassNames } from '@/components/ui'
import type { ProblemsPanelProps } from './contracts'
import { buildFixRequest, describeProblemLabel, problemNodeTitle, problemTargetNodeId, sortProblems } from './problems/problemDisplay'
import { messages } from '@/i18n'

const panelButtonClassNames = 'h-7 cursor-pointer rounded-md border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink hover:bg-subtle'

/**
 * Problems of the working graph (spec E, artboard 37): "2 problems to fix before it runs",
 * one row per problem with its label, the step and the message, Show node (selects and
 * centers it), Trust <host> for a lookup that only needs its host trusted, Fix with builder
 * (prefills the chat; the user sends it), and why Test is off.
 * After Validate with nothing found it says so; otherwise it renders nothing without problems.
 */
export function ProblemsPanel({ problems, graph, onSelectNode, onShowProblem, onFixWithBuilder, onTrustHost, trustError = null, testBlockReason = null, wasValidated = false, onClose }: ProblemsPanelProps) {
  const sorted = sortProblems(problems)
  const errorCount = sorted.filter((problem) => problem.severity === 'error').length
  if (sorted.length === 0) {
    if (!wasValidated) return null
    return (
      <section aria-label={messages().nodes.problems} className="flex items-center gap-2 border-t border-line bg-surface px-4 py-2 text-[12px] text-ok-strong">
        <span className="flex-1">{messages().nodes.validateFoundNoProblems}</span>
        {onClose && (
          <button type="button" onClick={onClose} className={panelButtonClassNames}>
            {messages().nodes.close}
          </button>
        )}
      </section>
    )
  }
  const heading = errorCount > 0 ? messages().nodes.problemsToFix(errorCount) : messages().nodes.warningsCount(sorted.length)
  return (
    <section aria-label={messages().nodes.problems} className="box-border flex max-h-56 flex-col gap-2 overflow-y-auto border-t border-line bg-surface px-4 py-2.5 text-[12px]">
      <div className="flex items-center gap-2">
        <span className={joinClassNames('flex-1 text-[13px] font-semibold', errorCount > 0 ? 'text-danger' : 'text-amber-strong')}>{heading}</span>
        {onClose && (
          <button type="button" onClick={onClose} className={panelButtonClassNames}>
            {messages().nodes.close}
          </button>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {sorted.map((problem, problemIndex) => {
          const nodeId = problemTargetNodeId(problem, graph)
          const title = problemNodeTitle(problem, graph)
          const trustHost = problem.trustHost ?? null
          return (
            <li
              key={`${problem.code}-${problem.nodeId}-${problem.edgeId}-${problemIndex}`}
              data-testid="problem-row"
              className={joinClassNames('flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border px-3 py-2', problem.severity === 'error' ? 'border-danger-line bg-danger-tint' : 'border-amber-line-2 bg-amber-tint')}
            >
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                <span className={joinClassNames('font-semibold', problem.severity === 'error' ? 'text-danger' : 'text-amber-strong')}>
                  {describeProblemLabel(problem)}
                  {title ? <span className="font-medium text-ink-2"> · {title}</span> : null}
                </span>
                <span className="text-body">{problem.message}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {trustHost && onTrustHost && (
                  <button type="button" onClick={() => onTrustHost(trustHost)} className={panelButtonClassNames}>
                    {messages().nodes.trust}{' '}{trustHost}
                  </button>
                )}
                {nodeId && (
                  <button type="button" onClick={() => (onShowProblem ? onShowProblem(problem, nodeId) : onSelectNode(nodeId))} className={panelButtonClassNames}>
                    {messages().nodes.showNode}
                  </button>
                )}
                {onFixWithBuilder && (
                  <button type="button" onClick={() => onFixWithBuilder(buildFixRequest(problem, graph))} className={panelButtonClassNames}>
                    {messages().nodes.fixWithBuilder}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {trustError && (
        <p role="alert" className="m-0 text-danger">
          {trustError}
        </p>
      )}
      {testBlockReason && <p className="m-0 text-muted">{testBlockReason}</p>}
    </section>
  )
}
