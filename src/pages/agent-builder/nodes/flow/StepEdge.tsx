import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { joinClassNames } from '@/components/ui'
import { useCanvasNodeActions } from './canvasActions'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from './flowLibrary'
import { edgeColors, type EdgeKind, type StepFlowEdge } from './toFlowElements'
import { messages } from '@/i18n'

/**
 * One arrow (spec N1 "Ports and arrows"): grey with an arrowhead, dashed red from an
 * On error port, dashed faint with "not used" when its exit is gone, brand when selected.
 * Branch and error arrows carry their exit's name at their middle, and hovering or
 * selecting an arrow shows a "+" there that inserts a step on it.
 */

/** How long the "+" stays after the pointer leaves the arrow, so it can be reached. */
const hoverLeaveDelayMs = 220

/** Stacking of arrow labels: over loop containers, which React Flow draws above the label layer. */
const edgeLabelZIndex = 1001

const labelToneClassNames: Record<EdgeKind, string> = {
  default: 'border-line bg-surface text-muted',
  branch: 'border-brand-line bg-brand-soft text-brand-strong',
  error: 'border-danger-line bg-danger-soft text-danger',
  unused: 'border-line bg-surface text-muted',
}

/** Hover state that survives the short trip from the arrow to its "+" button. */
function useLingeringHover(): { isHovered: boolean; enter: () => void; leave: () => void } {
  const [isHovered, setIsHovered] = useState(false)
  const leaveTimerRef = useRef<number | null>(null)
  const enter = useCallback(() => {
    if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = null
    setIsHovered(true)
  }, [])
  const leave = useCallback(() => {
    if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = window.setTimeout(() => setIsHovered(false), hoverLeaveDelayMs)
  }, [])
  useEffect(() => () => {
    if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current)
  }, [])
  return { isHovered, enter, leave }
}

export const StepEdge = memo(function StepEdge(props: EdgeProps<StepFlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data } = props
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 18 })
  const { addNodeOnEdge } = useCanvasNodeActions()
  const { isHovered, enter, leave } = useLingeringHover()
  const kind = data?.kind ?? 'default'
  const stroke = selected ? edgeColors.selected : edgeColors[kind]
  const isDashed = kind === 'error' || kind === 'unused'
  const showsAddButton = Boolean(addNodeOnEdge) && (isHovered || Boolean(selected))
  const label = data?.label ?? null
  return (
    <>
      <g onMouseEnter={enter} onMouseLeave={leave}>
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          interactionWidth={18}
          style={{ stroke, strokeWidth: selected ? 2.5 : 2, strokeDasharray: isDashed ? '6 4' : undefined }}
        />
      </g>
      {(label || showsAddButton) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute flex items-center gap-1"
            // Above loop containers (their tinted body would otherwise wash the label out).
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, zIndex: edgeLabelZIndex }}
            data-testid={`edge-label-${id}`}
          >
            {label && (
              <span className={joinClassNames('whitespace-nowrap rounded-md border px-1.5 py-px text-[11px] font-semibold', labelToneClassNames[kind])}>{label}</span>
            )}
            {showsAddButton && (
              <button
                type="button"
                aria-label={messages().nodes.addAStepOnThisArrow}
                title={messages().nodes.addAStepOnThisArrow}
                onMouseEnter={enter}
                onMouseLeave={leave}
                onClick={(event) => {
                  event.stopPropagation()
                  addNodeOnEdge?.(id)
                }}
                className="pointer-events-auto flex size-5 cursor-pointer items-center justify-center rounded-full border border-brand bg-surface p-0 text-brand shadow-sm hover:bg-brand hover:text-white"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

export const flowEdgeTypes = { 'step-edge': StepEdge }
