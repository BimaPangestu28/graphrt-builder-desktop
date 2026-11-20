import type { NodeInspectorProps } from './contracts'

/**
 * STUB (phase 2, inspector agent): the settings of the selected node, per the spec's
 * B-boards (B2 Change action … B14). Edit through `controller.updateNode(id, changes,
 * description)`; ports, names and unused arrows follow automatically (`graphEdits.ts`).
 * Today it only names the node and shows its problems.
 */
export function NodeInspector({ node, kindInfo, problems, onClose }: NodeInspectorProps) {
  if (!node) return null
  return (
    <aside aria-label="Step settings" className="box-border flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-ink">{node.displayTitle}</span>
          <span className="text-[12px] text-muted">{kindInfo?.displayName ?? node.kind}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close step settings" className="cursor-pointer rounded-md border-0 bg-transparent px-2 py-1 text-muted hover:bg-subtle">
          ✕
        </button>
      </div>
      {problems.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] text-danger">
          {problems.map((problem) => (
            <li key={`${problem.code}-${problem.message}`}>{problem.message}</li>
          ))}
        </ul>
      )}
      <p className="m-0 text-[12px] text-muted">Editing step settings here is coming soon. Ask the builder in the chat to change this step.</p>
    </aside>
  )
}
