import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { AgentGraph } from '@/api/agentGraphTypes'
import type { AddNodeAnchor } from '../contracts'
import { describeAnchor } from './nodePlacement'
import { findDropTarget, isNodeKindDrag, nodeKindDragType, type DropTarget } from './paletteDrag'
import { messages } from '@/i18n'

interface PaletteDropZoneProps {
  graph: AgentGraph
  readOnly: boolean
  /** The kind being dragged right now (set by the palette on drag start), for the ghost's name. */
  draggedKindName: string | null
  onDropKind: (kind: string, anchor: AddNodeAnchor) => void
  children: ReactNode
}

function ghostLabel(graph: AgentGraph, anchor: AddNodeAnchor): string {
  if (anchor.type === 'on-edge') return messages().nodes.insertHere
  if (anchor.type === 'after-node' || anchor.type === 'after-exit') return messages().nodes.addAnchor(describeAnchor(graph, anchor))
  return anchor.parentId ? messages().nodes.addAnchor(describeAnchor(graph, anchor)) : messages().nodes.dropToAddItHere
}

const ghostWidth = 220

/**
 * A dashed card under the pointer (so the arrow under it stays visible), with a marker on the
 * drop point and the "Insert here" pill; kept inside the canvas.
 */
function DropGhost({ graph, dropTarget, kindName, zoneWidth }: { graph: AgentGraph; dropTarget: DropTarget; kindName: string | null; zoneWidth: number }) {
  const label = ghostLabel(graph, dropTarget.anchor)
  const isOnEdge = dropTarget.anchor.type === 'on-edge'
  const left = Math.max(8, Math.min(dropTarget.ghostX - ghostWidth / 2, zoneWidth - ghostWidth - 8))
  return (
    <div aria-hidden="true" data-testid="palette-drop-ghost" className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {isOnEdge && <span className="absolute size-3 rounded-full border-2 border-surface bg-ok-strong shadow" style={{ left: dropTarget.ghostX - 6, top: dropTarget.ghostY - 6 }} />}
      <div className="absolute flex flex-col items-start gap-1" style={{ left, top: dropTarget.ghostY + 14, width: ghostWidth }}>
        <span className="whitespace-nowrap rounded-md bg-ok-strong px-2 py-0.5 text-[11px] font-semibold text-white">{label}</span>
        <div className="flex w-full flex-col gap-0.5 rounded-xl border-2 border-dashed border-ok bg-surface/95 px-3 py-2 shadow-[0_4px_14px_rgba(0,0,0,0.08)]">
          <span className="truncate text-[13px] font-semibold text-ink">{kindName ?? messages().nodes.newStep}</span>
          <span className="line-clamp-2 text-[11px] leading-snug text-muted">{isOnEdge ? messages().nodes.dropToPutItAnchor(describeAnchor(graph, dropTarget.anchor)) : messages().nodes.releaseToAddIt}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Wraps the canvas and takes drops from the palette (spec 34 / 47): while a step is dragged
 * over the canvas a dashed ghost follows the pointer, labelled "Insert here" over an arrow;
 * dropping adds it on that arrow, after the step under it, or at that spot. Nothing changes
 * for other drags.
 */
export function PaletteDropZone({ graph, readOnly, draggedKindName, onDropKind, children }: PaletteDropZoneProps) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const containerIds = useMemo(() => new Set(graph.nodes.filter((node) => node.container).map((node) => node.id)), [graph])

  function targetAt(event: DragEvent<HTMLDivElement>): DropTarget | null {
    if (!zoneRef.current) return null
    return findDropTarget(zoneRef.current, { clientX: event.clientX, clientY: event.clientY }, containerIds)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (readOnly || !isNodeKindDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropTarget(targetAt(event))
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (zoneRef.current && event.relatedTarget instanceof Node && zoneRef.current.contains(event.relatedTarget)) return
    setDropTarget(null)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (readOnly || !isNodeKindDrag(event.dataTransfer)) return
    event.preventDefault()
    const kind = event.dataTransfer.getData(nodeKindDragType)
    const target = targetAt(event)
    setDropTarget(null)
    if (kind && target) onDropKind(kind, target.anchor)
  }

  return (
    <div ref={zoneRef} className="relative h-full w-full" data-testid="palette-drop-zone" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {children}
      {dropTarget && <DropGhost graph={graph} dropTarget={dropTarget} kindName={draggedKindName} zoneWidth={zoneRef.current?.clientWidth ?? 0} />}
    </div>
  )
}
