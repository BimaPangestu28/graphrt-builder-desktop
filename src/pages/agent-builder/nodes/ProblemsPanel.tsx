import type { ProblemsPanelProps } from './contracts'

/**
 * Problems of the working graph (spec E). Phase 1: a plain list; a problem pinned to a
 * step selects it. Phase 2 (live/sync agent) styles it per the spec and adds the
 * "Test is off because…" line.
 */
export function ProblemsPanel({ problems, graph, onSelectNode }: ProblemsPanelProps) {
  if (problems.length === 0) return null
  const titleOf = (nodeId: string) => graph.nodes.find((node) => node.id === nodeId)?.displayTitle ?? nodeId
  return (
    <section aria-label="Problems" className="box-border flex max-h-40 flex-col gap-1 overflow-y-auto border-t border-line bg-surface px-4 py-2 text-[12px]">
      <span className="font-semibold text-ink">{problems.length === 1 ? '1 problem' : `${problems.length} problems`}</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {problems.map((problem, problemIndex) => (
          <li key={`${problem.code}-${problemIndex}`} className={problem.severity === 'error' ? 'text-danger' : 'text-amber-strong'}>
            {problem.nodeId ? (
              <button type="button" onClick={() => onSelectNode(problem.nodeId as string)} className="cursor-pointer border-0 bg-transparent p-0 text-left font-medium text-inherit underline">
                {titleOf(problem.nodeId)}
              </button>
            ) : null}
            {problem.nodeId ? ': ' : ''}
            {problem.message}
          </li>
        ))}
      </ul>
    </section>
  )
}
