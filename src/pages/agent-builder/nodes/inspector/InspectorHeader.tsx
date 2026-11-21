import { useSearchParams, useInRouterContext } from 'react-router-dom'
import type { GraphNode, NodeKindGroup, NodeKindInfo } from '@/api/agentGraphTypes'
import { Button, Icon, joinClassNames } from '@/components/ui'
import { usePluginIcon } from '@/hooks/usePluginIcon'
import { builderAskParam } from '@/routes'
import { TextInput } from './fields'
import { useInspector } from './InspectorContext'

/**
 * Top and bottom of the step inspector (spec B1): kind icon, "plugin · action" or the
 * kind's name, the editable title and the kind's description; and the footer with
 * "Ask the builder about this node", Duplicate and Delete.
 */

const groupTones: Record<NodeKindGroup, string> = {
  'start-and-finish': 'bg-chip text-ink-2',
  ai: 'bg-brand-soft text-brand-strong',
  connect: 'bg-amber-soft text-amber-strong',
  'decide-and-wait': 'bg-amber-soft text-amber-deep',
  repeat: 'bg-selected text-ink-2',
  data: 'bg-chip text-ink-2',
  plugin: 'bg-ok-soft text-ok-strong',
  hidden: 'bg-chip text-muted',
  other: 'bg-chip text-muted',
}

/** "WW" for WhatsApp Web, "AM" for Ask a model. */
export function initialsOf(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean)
  return (words.length >= 2 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

function KindIcon({ node, kindInfo }: { node: GraphNode; kindInfo: NodeKindInfo | null }) {
  const pluginName = kindInfo?.plugin?.name ?? node.plugin
  const iconDataUrl = usePluginIcon(pluginName ?? '', pluginName ? undefined : null)
  const label = kindInfo?.plugin?.displayName ?? kindInfo?.displayName ?? node.displayTitle
  const tone = groupTones[kindInfo?.group ?? (pluginName ? 'plugin' : 'other')]
  return (
    <span aria-hidden="true" className={joinClassNames('flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg text-[11px] font-semibold tracking-[0.3px]', tone)}>
      {iconDataUrl ? <img src={iconDataUrl} alt="" className="h-full w-full object-cover" /> : initialsOf(label)}
    </span>
  )
}

/** What the header's small line says: "WhatsApp Web · Send WhatsApp message" or "Ask a model". */
export function describeKindLine(node: GraphNode, kindInfo: NodeKindInfo | null): string {
  if (kindInfo?.plugin) return `${kindInfo.plugin.displayName} · ${kindInfo.displayName}`
  if (node.plugin) return `${node.plugin} · ${node.kind.slice(node.plugin.length + 1)}`
  return kindInfo?.displayName ?? node.kind
}

export function InspectorHeader({ onClose }: { onClose: () => void }) {
  const { node, kindInfo, readOnly, updateNode } = useInspector()
  return (
    <div className="flex items-start gap-2.5">
      <KindIcon node={node} kindInfo={kindInfo} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[11px] font-semibold text-muted" title={node.kind}>
          {describeKindLine(node, kindInfo)}
        </span>
        <TextInput
          ariaLabel="Node title"
          value={node.title ?? node.displayTitle}
          disabled={readOnly}
          className="-ml-1.5 border-transparent px-1.5 text-[14px] font-semibold hover:border-line-strong"
          onCommit={(title) => {
            const trimmed = title.trim()
            updateNode({ title: trimmed || null }, trimmed ? `renamed to “${trimmed}”` : 'removed the title')
          }}
        />
        {kindInfo?.description && <span className="text-[12px] leading-snug text-muted">{kindInfo.description}</span>}
        <span className="font-mono text-[11px] text-faint" title="Step id: references use it, so it never changes">
          {node.id}
        </span>
      </div>
      <button type="button" onClick={onClose} aria-label="Close step settings" className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] border-0 bg-chip text-ink-2 hover:bg-selected">
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}

/** The chat request "Ask the builder about this node" prefills (never sent by itself). */
export function describeAskAboutNode(node: GraphNode, kindLine: string): string {
  return `About the step "${node.displayTitle}" (${node.id}, ${kindLine}): `
}

function AskBuilderThroughUrl({ text }: { text: string }) {
  const [, setSearchParams] = useSearchParams()
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() =>
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current)
            next.set(builderAskParam, text)
            return next
          },
          { replace: true },
        )
      }
    >
      Ask the builder about this node
    </Button>
  )
}

interface InspectorFooterProps {
  onDuplicate: () => void
  onDelete: () => void
  /** Prefills the builder chat; without it the inspector sets the builder's `ask` search param. */
  onAskBuilder?: (text: string) => void
}

export function InspectorFooter({ onDuplicate, onDelete, onAskBuilder }: InspectorFooterProps) {
  const { node, kindInfo, readOnly } = useInspector()
  const isInRouter = useInRouterContext()
  const askText = describeAskAboutNode(node, describeKindLine(node, kindInfo))
  const isEntry = node.kind === 'start'
  return (
    <div className="mt-auto flex flex-col gap-2 border-t border-chip pt-3">
      {onAskBuilder ? (
        <Button variant="secondary" size="sm" onClick={() => onAskBuilder(askText)}>
          Ask the builder about this node
        </Button>
      ) : (
        isInRouter && <AskBuilderThroughUrl text={askText} />
      )}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" disabled={readOnly || isEntry} onClick={onDuplicate}>
          Duplicate
        </Button>
        <Button variant="ghost" size="sm" className="text-danger" disabled={readOnly || isEntry} onClick={onDelete} title={isEntry ? 'Every agent starts here' : undefined}>
          Delete
        </Button>
      </div>
    </div>
  )
}
