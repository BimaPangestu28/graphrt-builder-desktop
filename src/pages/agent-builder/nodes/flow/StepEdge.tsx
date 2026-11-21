import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from './flowLibrary'
import { edgeColors, type StepFlowEdge } from './toFlowElements'

/**
 * One arrow (spec N1 "Ports and arrows"): grey with an arrowhead, dashed red from an
 * On error port, dashed faint with "not used" when its exit is gone, brand when selected.
 */
export const StepEdge = memo(function StepEdge(props: EdgeProps<StepFlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data } = props
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 18 })
  const kind = data?.kind ?? 'default'
  const stroke = selected ? edgeColors.selected : edgeColors[kind]
  const isDashed = kind === 'error' || kind === 'unused'
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{ stroke, strokeWidth: selected ? 2.5 : 2, strokeDasharray: isDashed ? '6 4' : undefined }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <span
            className="nodrag nopan pointer-events-none absolute rounded-md border border-line bg-surface px-1.5 py-px text-[11px] font-medium text-muted"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

export const flowEdgeTypes = { 'step-edge': StepEdge }
