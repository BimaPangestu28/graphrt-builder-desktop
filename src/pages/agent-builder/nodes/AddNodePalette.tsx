import type { AddNodePaletteProps } from './contracts'

/**
 * STUB (phase 2, palette agent): the Add node palette (spec C, C2, N1): offered kinds
 * grouped by `NodeKindInfo.group`, installed plugins, then catalog plugins that install
 * after approval. Build the node with `createGraphNode` + `uniqueNodeId` (`graphEdits.ts`)
 * and hand it to `onAddNode`. Today it lists the offered kinds without adding them.
 */
export function AddNodePalette({ isOpen, nodeKinds, onClose }: AddNodePaletteProps) {
  if (!isOpen) return null
  const offeredKinds = nodeKinds.filter((kindInfo) => kindInfo.offered)
  return (
    <aside aria-label="Add node" className="box-border flex w-[280px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink">Add node</span>
        <button type="button" onClick={onClose} aria-label="Close Add node" className="cursor-pointer rounded-md border-0 bg-transparent px-2 py-1 text-muted hover:bg-subtle">
          ✕
        </button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {offeredKinds.map((kindInfo) => (
          <li key={kindInfo.kind} className="flex flex-col rounded-lg px-2 py-1.5 text-[13px]">
            <span className="text-ink">{kindInfo.displayName}</span>
            <span className="text-[11px] text-muted">{kindInfo.kind}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
