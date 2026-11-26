import { memo, type KeyboardEvent } from 'react'
import type { NodePort } from '@/api/agentGraphTypes'
import { joinClassNames } from '@/components/ui'
import { containerMinimumSize } from './autoLayout'
import { compactZoomThreshold, useCanvasNodeActions, useContainerDropHint } from './canvasActions'
import { Handle, NodeResizer, Position, useStore, type NodeProps } from './flowLibrary'
import { NodeDecoration } from '../run/NodeDecorations'
import { NodeKindIcon } from './NodeKindIcon'
import type { PreviewSegment } from './nodePreview'
import { cardHeightFor, portOffset } from './nodeGeometry'
import type { StepFlowNode, StepNodeData } from './toFlowElements'
import { messages } from '@/i18n'

/**
 * Canvas renderers for the three node types (spec N1 anatomy): a step card, a
 * container (For each / Repeat) holding its body, and the hidden body entry (only its
 * exit port shows). Ports are focusable: Enter on one starts an arrow from it.
 */

/** True while the canvas is zoomed out far enough for compact cards (below 60%). */
function useIsCompact(): boolean {
  return useStore((state) => state.transform[2] < compactZoomThreshold)
}

function portLabel(outputPort: NodePort): string {
  if (outputPort.role === 'fail-branch') return messages().nodes.onError
  return outputPort.label || outputPort.id
}

function describePort(outputPort: NodePort, nodeTitle: string): string {
  if (outputPort.role === 'default') return messages().nodes.connectFromNodetitle(nodeTitle)
  return messages().nodes.connectFromTheValueExitOf(portLabel(outputPort), nodeTitle)
}

interface OutputPortsProps {
  data: StepNodeData
  /** Height of the card, for exits along its right edge (direction 'right'). */
  height: number
  /**
   * Shows the names of branch exits that have no arrow ("Skip": nothing follows). Exits with
   * an arrow are named on the arrow itself (`StepEdge`), so labels never cover other arrows.
   */
  showLabels: boolean
}

/** Where exit `portIndex` sits: along the bottom (as a %) or the right edge (px). */
function exitPlacement(direction: StepNodeData['flowDirection'], portIndex: number, portCount: number, height: number) {
  if (direction === 'down') return { left: `${((portIndex + 1) / (portCount + 1)) * 100}%` }
  return { top: portOffset(portIndex, portCount, height) }
}

const portLabelToneClassNames: Record<NodePort['role'], string> = {
  'fail-branch': 'border-danger-line bg-danger-soft text-danger',
  branch: 'border-brand-line bg-brand-soft text-brand-strong',
  else: 'border-line bg-surface text-ink-2',
  default: '',
  input: '',
}

function OutputPorts({ data, height, showLabels }: OutputPortsProps) {
  const { node, connectedHandles, readOnly, flowDirection } = data
  const { startKeyboardConnect } = useCanvasNodeActions()
  const outputs = node.ports.outputs
  function handlePortKey(event: KeyboardEvent, outputPort: NodePort) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    startKeyboardConnect(node.id, outputPort.id)
  }
  return (
    <>
      {outputs.map((outputPort, portIndex) => {
        const placement = exitPlacement(flowDirection, portIndex, outputs.length, height)
        const isConnected = connectedHandles.includes(outputPort.id)
        const isNamed = outputPort.role !== 'default'
        return (
          <div key={outputPort.id}>
            <Handle
              id={outputPort.id}
              type="source"
              position={flowDirection === 'down' ? Position.Bottom : Position.Right}
              isConnectable={!readOnly}
              tabIndex={readOnly ? -1 : 0}
              role="button"
              aria-label={describePort(outputPort, node.displayTitle)}
              title={isNamed && !isConnected && outputPort.role !== 'fail-branch' ? messages().nodes.valueNoArrowThisItemEnds(portLabel(outputPort)) : undefined}
              onKeyDown={(event) => handlePortKey(event, outputPort)}
              data-port-role={outputPort.role}
              className={joinClassNames('step-port', outputPort.role === 'fail-branch' && 'step-port-error')}
              style={placement}
            >
              {outputPort.role === 'fail-branch' && (
                <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8" className="pointer-events-none">
                  <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              )}
            </Handle>
            {showLabels && isNamed && !isConnected && (
              <span
                aria-hidden="true"
                className={joinClassNames(
                  'pointer-events-none absolute z-[1] whitespace-nowrap rounded-md border px-1.5 py-px text-[11px] font-semibold',
                  // Right of the port and below its line: arrows from the exits above stay clear.
                  flowDirection === 'down' ? 'top-full mt-1.5 translate-x-2' : 'left-full ml-2 translate-y-[3px]',
                  portLabelToneClassNames[outputPort.role],
                  'opacity-60',
                )}
                style={placement}
              >
                {portLabel(outputPort)}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}

function InputPort({ data, top }: { data: StepNodeData; top?: number }) {
  if (data.node.ports.inputs.length === 0) return null
  const isDown = data.flowDirection === 'down'
  return (
    <Handle
      id="target"
      type="target"
      position={isDown ? Position.Top : Position.Left}
      isConnectable={!data.readOnly}
      isConnectableStart={false}
      tabIndex={-1}
      aria-hidden="true"
      className="step-port"
      style={isDown || top === undefined ? undefined : { top }}
    />
  )
}

function PreviewLine({ segments }: { segments: PreviewSegment[] }) {
  if (segments.length === 0) return null
  return (
    <span className="line-clamp-2 text-[12px] leading-[1.45] text-body">
      {segments.map((segment, segmentIndex) =>
        segment.kind === 'reference' ? (
          <span key={segmentIndex} className="rounded-[5px] bg-brand-soft px-[5px] font-medium text-brand-strong">
            {segment.text}
          </span>
        ) : (
          <span key={segmentIndex}>{segment.text}</span>
        ),
      )}
    </span>
  )
}

function BadgeRow({ data }: { data: StepNodeData }) {
  const { badges, problems } = data
  const errorCount = problems.filter((problem) => problem.severity === 'error').length
  if (badges.length === 0 && problems.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span key={badge.key} className={joinClassNames('inline-flex items-center rounded-md px-1.5 py-px text-[11px] font-semibold', badge.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-chip text-ink-2')}>
          {badge.label}
        </span>
      ))}
      {problems.length > 0 && (
        <span className={joinClassNames('inline-flex items-center rounded-md px-1.5 py-px text-[11px] font-semibold', errorCount > 0 ? 'bg-danger-soft text-danger' : 'bg-amber-soft text-amber-strong')}>
          {problems.length === 1 ? messages().nodes.n1Problem : messages().nodes.valueProblems(problems.length)}
        </span>
      )}
    </span>
  )
}

function SetupStatusPill({ data }: { data: StepNodeData }) {
  if (!data.setupStatus) return null
  return (
    <span
      className={joinClassNames(
        'absolute -right-1.5 -top-[9px] whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold',
        data.setupStatus.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-amber-soft text-amber-strong',
      )}
    >
      {data.setupStatus.label}
    </span>
  )
}

/** The reason an arrow cannot end here, or "Drop to connect", while one is drawn. */
function ConnectionHint({ data }: { data: StepNodeData }) {
  const check = data.connectionCheck
  if (!check) return null
  if (check.allowed) {
    return <span className="connect-hint pointer-events-none absolute -top-3 left-3 rounded-md bg-brand px-1.5 py-px text-[11px] font-semibold text-white">{messages().nodes.dropToConnect}</span>
  }
  return (
    <span role="tooltip" className="connect-hint pointer-events-none absolute left-0 top-full z-10 mt-2 w-[240px] rounded-lg bg-ink px-2.5 py-1.5 text-[12px] leading-[1.4] text-white shadow-md">
      {check.reason}
    </span>
  )
}

function connectionStateClassName(data: StepNodeData): string | false {
  if (data.isConnectSource) return 'is-connect-source'
  if (!data.connectionCheck) return false
  return data.connectionCheck.allowed ? 'is-valid-target' : 'is-invalid-target'
}

function cardToneClassNames(data: StepNodeData, selected: boolean): string {
  if (data.node.needsApproval) return joinClassNames('border-2 bg-amber-tint', selected ? 'border-brand' : 'border-amber-line')
  return joinClassNames('bg-surface', selected ? 'border-2 border-brand' : 'border border-line-strong hover:border-line-heavy')
}

/** A compact card at far zoom: logo and title; badges and setup gaps become one dot. */
function CompactCard({ data, selected, height }: { data: StepNodeData; selected: boolean; height: number }) {
  const { node } = data
  const hasMarks = data.badges.length > 0 || data.problems.length > 0 || data.setupStatus !== null
  return (
    <div
      data-testid={`node-${node.id}`}
      data-compact="true"
      className={joinClassNames('step-card relative box-border flex w-[240px] items-center gap-2.5 rounded-xl px-3', cardToneClassNames(data, selected), connectionStateClassName(data))}
      style={{ height }}
    >
      <InputPort data={data} />
      <NodeKindIcon kind={node.kind} pluginName={node.plugin} tone={node.needsApproval ? 'amber' : 'neutral'} />
      <span className="line-clamp-2 min-w-0 flex-1 text-[18px] font-semibold leading-tight text-ink">{node.displayTitle}</span>
      {hasMarks && <span aria-label={messages().nodes.hasBadges} className={joinClassNames('size-2.5 shrink-0 rounded-full', data.setupStatus || data.problems.length > 0 ? 'bg-amber' : 'bg-faint')} />}
      <OutputPorts data={data} height={height} showLabels={false} />
      <NodeDecoration nodeId={node.id} />
    </div>
  )
}

/** One step card: logo, plugin line, title, kind, key setting, badges, ports. */
export const StepNodeCard = memo(function StepNodeCard({ data, selected }: NodeProps<StepFlowNode>) {
  const isCompact = useIsCompact()
  const { node } = data
  const height = cardHeightFor(node.ports.outputs.length)
  if (isCompact) return <CompactCard data={data} selected={selected} height={height} />
  return (
    <div
      data-testid={`node-${node.id}`}
      className={joinClassNames('step-card group relative box-border flex w-[240px] flex-col gap-1.5 rounded-xl px-3 py-2.5 shadow-sm', cardToneClassNames(data, selected), connectionStateClassName(data))}
      style={{ minHeight: height }}
    >
      <SetupStatusPill data={data} />
      <InputPort data={data} top={height / 2} />
      {data.pluginLine && <span className="truncate text-[11px] font-semibold text-ok-strong">{data.pluginLine}</span>}
      <span className="flex w-full items-center gap-2">
        <NodeKindIcon kind={node.kind} pluginName={node.plugin} tone={node.needsApproval ? 'amber' : 'neutral'} />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="line-clamp-2 text-[13px] font-semibold leading-[1.3] text-ink">{node.displayTitle}</span>
          <span className="truncate text-[11px] text-muted">{data.subtitle}</span>
        </span>
      </span>
      <PreviewLine segments={data.preview} />
      <BadgeRow data={data} />
      <ConnectionHint data={data} />
      <OutputPorts data={data} height={height} showLabels />
      <NodeDecoration nodeId={node.id} />
    </div>
  )
})

/** A For each / Repeat step: header on top, its body's steps inside, resizable when selected. */
export const ContainerNodeCard = memo(function ContainerNodeCard({ id, data, selected }: NodeProps<StepFlowNode>) {
  const isCompact = useIsCompact()
  const { resizeContainer } = useCanvasNodeActions()
  const dropHint = useContainerDropHint(id)
  const { node } = data
  const headerPortTop = 30
  return (
    <section
      data-testid={`node-${node.id}`}
      aria-label={messages().nodes.displaytitleALoop(node.displayTitle)}
      data-drop-target={dropHint ? (dropHint.allowed ? 'allowed' : 'refused') : undefined}
      className={joinClassNames(
        'step-card relative box-border h-full w-full rounded-2xl border-2 border-dashed bg-subtle/90',
        selected ? 'border-brand' : 'border-line-heavy',
        dropHint?.allowed && 'border-brand bg-brand-soft/60',
        dropHint && !dropHint.allowed && 'border-danger bg-danger-soft/50',
        connectionStateClassName(data),
      )}
    >
      {dropHint && (
        <span
          role="status"
          className={joinClassNames(
            'pointer-events-none absolute -top-3 left-12 z-10 max-w-[calc(100%-4rem)] truncate rounded-md px-1.5 py-px text-[11px] font-semibold text-white',
            dropHint.allowed ? 'bg-brand' : 'bg-danger',
          )}
        >
          {dropHint.allowed ? messages().nodes.dropToMoveIntoDisplaytitle(node.displayTitle) : dropHint.reason}
        </span>
      )}
      <NodeResizer
        isVisible={selected && !data.readOnly}
        minWidth={containerMinimumSize.width}
        minHeight={containerMinimumSize.height}
        lineClassName="container-resize-line"
        handleClassName="container-resize-handle"
        onResizeEnd={(_event, params) => resizeContainer({ nodeId: id, x: params.x, y: params.y, width: params.width, height: params.height })}
      />
      <InputPort data={data} top={headerPortTop} />
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <NodeKindIcon kind={node.kind} pluginName={null} />
        <span className="flex min-w-0 flex-col gap-px">
          <span className={joinClassNames('truncate font-semibold text-ink', isCompact ? 'text-[15px]' : 'text-[13px]')}>{node.displayTitle}</span>
          {!isCompact && (
            <span className="truncate text-[11px] text-muted">
              {data.kindName ?? node.kind}
              {data.preview.length > 0 ? ' · ' : ''}
              {data.preview.map((segment, segmentIndex) =>
                segment.kind === 'reference' ? (
                  <span key={segmentIndex} className="rounded-[5px] bg-brand-soft px-[5px] font-medium text-brand-strong">
                    {segment.text}
                  </span>
                ) : (
                  <span key={segmentIndex}>{segment.text}</span>
                ),
              )}
            </span>
          )}
        </span>
        {!isCompact && <BadgeRow data={data} />}
      </div>
      <ConnectionHint data={data} />
      <OutputPorts data={data} height={headerPortTop * 2} showLabels={!isCompact} />
      <NodeDecoration nodeId={node.id} variant="container" />
    </section>
  )
})

/** The End step as a pill (spec A): a check, "End" and what it returns. */
export const EndNodePill = memo(function EndNodePill({ data, selected }: NodeProps<StepFlowNode>) {
  const { node } = data
  const detail = node.detail && node.detail !== node.displayTitle ? node.detail : null
  return (
    <div
      data-testid={`node-${node.id}`}
      data-shape="pill"
      title={detail ? `${node.displayTitle} · ${detail}` : node.displayTitle}
      className={joinClassNames(
        'step-card relative box-border flex h-9 w-[200px] items-center gap-2 rounded-full bg-surface px-3 text-[12px] text-ink-2 shadow-sm',
        selected ? 'border-2 border-brand' : 'border border-line-strong hover:border-line-heavy',
        data.problems.length > 0 && !selected && 'border-amber-line',
        connectionStateClassName(data),
      )}
    >
      <InputPort data={data} top={18} />
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-ok-strong">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span className="min-w-0 truncate">
        <b className="font-semibold text-ink">{node.displayTitle}</b>
        {detail && ` · ${detail}`}
      </span>
      <ConnectionHint data={data} />
      <NodeDecoration nodeId={node.id} />
    </div>
  )
})

/** The hidden entry of a loop body: only the exit port its first arrows leave from shows. */
export const MarkerNodeDot = memo(function MarkerNodeDot({ data }: NodeProps<StepFlowNode>) {
  return (
    <div data-testid={`marker-${data.node.id}`} className="h-3 w-3">
      <OutputPorts data={{ ...data, node: { ...data.node, displayTitle: messages().nodes.startOfLoop(data.node.parent ?? null) } }} height={12} showLabels={false} />
    </div>
  )
})

export const flowNodeTypes = { step: StepNodeCard, container: ContainerNodeCard, marker: MarkerNodeDot, end: EndNodePill }
