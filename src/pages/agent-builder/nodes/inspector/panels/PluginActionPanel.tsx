import { useEffect, useRef, useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import type { JsonValue, NodeConfig, NodeKindInfo } from '@/api/agentGraphTypes'
import { listAgentPluginRequirements } from '@/api/plugins'
import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import { Badge, joinClassNames } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { pluginDetailPath } from '@/routes'
import { PluginSessionLinkAction } from '../../../PluginSessionLinkAction'
import { describeRequirementState, needsOnlySessionLink } from '../../../pluginRequirementDisplay'
import { isEmptyConfigValue, type JsonObject } from '../configPaths'
import { hintClassName, InspectorSection, labelClassName, linkButtonClassName, SelectInput } from '../fields'
import { revealElement, useSectionRequest } from '../sectionRequest'
import { useInspector } from '../InspectorContext'
import { parseTemplate } from '../references'
import { propertyLabel, SchemaForm, schemaProperties, schemaRequired } from '../SchemaForm'
import { messages } from '@/i18n'

/**
 * A plugin action step (spec B1 / B2): the plugin's setup state with a link to its page
 * (or the WhatsApp QR link), "Change action" listing the plugin's other actions, the
 * inputs from the action's config schema, and a "Not used by …" box for values the
 * current action does not read (kept so switching back loses nothing).
 */

/** The actions of one plugin, from the node library. */
export function listPluginActions(nodeKinds: NodeKindInfo[], pluginName: string): NodeKindInfo[] {
  return nodeKinds.filter((info) => info.plugin?.name === pluginName && info.offered)
}

/**
 * Config keys that `kindInfo`'s schema does not list. A kind whose schema lists nothing
 * may still read keys, so then only an action change (`afterChange`) marks them unused.
 */
export function listUnusedConfigKeys(config: NodeConfig, kindInfo: NodeKindInfo | null, afterChange = false): string[] {
  const properties = schemaProperties(kindInfo?.configSchema).map(([name]) => name)
  if (properties.length === 0 && !afterChange) return []
  return Object.keys(config).filter((key) => !properties.includes(key))
}

/** What changing a plugin step to another action keeps, needs and leaves unused. */
export interface ActionChange {
  fromKind: string
  fromConfig: NodeConfig
  /** Inputs both actions have and that already hold a value. */
  keptKeys: string[]
  /** Required inputs of the new action that are still empty. */
  neededKeys: string[]
  /** Values the new action does not read (kept in the config). */
  unusedKeys: string[]
}

/**
 * Plans a change of action: the config stays as it is (shared inputs keep their values,
 * others wait in "Not used by …"), and the new action's empty required inputs are flagged.
 */
export function planActionChange(config: NodeConfig, fromKind: string, toKindInfo: NodeKindInfo): ActionChange {
  const newProperties = schemaProperties(toKindInfo.configSchema).map(([name]) => name)
  const keptKeys = Object.keys(config).filter((key) => newProperties.includes(key) && !isEmptyConfigValue(config[key]))
  const neededKeys = schemaRequired(toKindInfo.configSchema).filter((key) => isEmptyConfigValue(config[key]))
  return { fromKind, fromConfig: config, keptKeys, neededKeys, unusedKeys: listUnusedConfigKeys(config, toKindInfo, true) }
}

function previewValue(value: JsonValue): string {
  if (typeof value !== 'string') return JSON.stringify(value)
  return parseTemplate(value)
    .map((part) => (part.type === 'text' ? part.text : part.path.slice(-1)[0] === 'text' && part.path.length === 2 ? part.path[0].replace(/_/g, ' ') : part.path.slice(1).join('.')))
    .join('')
}

function PluginSetupStatus({ kindInfo }: { kindInfo: NodeKindInfo }) {
  const { graph } = useInspector()
  const isInRouter = useInRouterContext()
  const pluginName = kindInfo.plugin?.name ?? ''
  const { data: requirements, reload } = useAsyncData(() => listAgentPluginRequirements(graph.agentId), [graph.agentId])
  const requirement: PluginRequirement | undefined = requirements?.find((candidate) => candidate.name === pluginName)
  const isInstalled = requirement?.installed ?? kindInfo.plugin?.installed ?? false
  const state = requirement ? describeRequirementState(requirement) : isInstalled ? null : messages().nodes.notInstalled
  const isReady = requirement?.ready ?? false
  const pluginPageLink = isInRouter ? (
    <Link to={pluginDetailPath(pluginName)} className="text-[12px] font-medium">
      {messages().nodes.openPluginPage}
    </Link>
  ) : null
  return (
    <div className={joinClassNames('flex flex-col gap-2 rounded-[10px] border px-3 py-2.5', isReady || state === null ? 'border-line bg-subtle' : 'border-amber-line-2 bg-amber-tint')}>
      <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        {kindInfo.plugin?.displayName ?? pluginName} {messages().nodes.plugin}
        {state && <Badge tone={isReady ? 'ok' : 'amber'}>{state}</Badge>}
      </span>
      {requirement && needsOnlySessionLink(requirement) ? (
        <PluginSessionLinkAction label={requirement.displayName} onSessionChange={() => reload()} />
      ) : (
        !isReady && state !== null && (
          <span className={hintClassName}>
            {isInstalled ? messages().nodes.finishItsSetupOnThePlugin : messages().nodes.addingThisStepInstallsThePlugin} {pluginPageLink}
          </span>
        )
      )}
      {(isReady || state === null) && pluginPageLink}
    </div>
  )
}

function ChangeActionField({ actions, onChangeAction }: { actions: NodeKindInfo[]; onChangeAction: (kindInfo: NodeKindInfo) => void }) {
  const { node, kindInfo, readOnly } = useInspector()
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const pluginName = kindInfo?.plugin?.name ?? node.plugin ?? ''
  const canChange = !readOnly && actions.length >= 2
  const { request, claim } = useSectionRequest()
  // Canvas menu "Change action": open the list and focus the picker (once per request).
  useEffect(() => {
    if (request?.section !== 'change-action' || !claim(request.sequence)) return
    if (canChange) setIsOpen(true)
    revealElement(buttonRef.current)
  }, [request, claim, canChange])
  return (
    <div className="flex flex-col gap-1.5" data-section-key="change-action">
      <span className={labelClassName}>{messages().nodes.action}</span>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={messages().nodes.actionValueChangeAction(kindInfo?.displayName ?? node.kind)}
        disabled={!canChange}
        onClick={() => setIsOpen((open) => !open)}
        className="box-border flex h-[34px] cursor-pointer items-center justify-between gap-2 rounded-[9px] border border-line-strong bg-surface px-2 text-left text-[13px] text-ink disabled:cursor-default"
      >
        <span className="truncate">{kindInfo?.displayName ?? node.kind}</span>
        {actions.length > 1 && <span className="text-[12px] text-muted">{messages().nodes.change}</span>}
      </button>
      {isOpen && (
        <div role="listbox" aria-label={messages().nodes.pluginnameActions(pluginName)} className="flex flex-col gap-0.5 rounded-[10px] border border-line bg-surface p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.10)]">
          <span className="px-1.5 text-[11px] font-semibold tracking-[0.4px] text-muted uppercase">
            {pluginName} · {actions.length} {messages().nodes.actions}
          </span>
          {actions.map((action) => {
            const isCurrent = action.kind === node.kind
            return (
              <button
                key={action.kind}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => {
                  setIsOpen(false)
                  if (!isCurrent) onChangeAction(action)
                }}
                className={joinClassNames('flex cursor-pointer flex-col gap-0.5 rounded-md border-0 px-2 py-1.5 text-left', isCurrent ? 'bg-brand-soft' : 'bg-transparent hover:bg-subtle')}
              >
                <span className="text-[13px] font-semibold text-ink">{action.displayName}</span>
                {action.description && <span className="text-[12px] leading-snug text-muted">{action.description}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NotUsedBox({ unusedKeys }: { unusedKeys: string[] }) {
  const { node, kindInfo, readOnly, updateConfig } = useInspector()
  const emptyTargets = schemaProperties(kindInfo?.configSchema).filter(([name]) => isEmptyConfigValue(node.config[name]))
  if (unusedKeys.length === 0) return null
  return (
    <div role="group" aria-label={messages().nodes.notUsedByValue(kindInfo?.displayName ?? node.kind)} className="flex flex-col gap-2 rounded-[10px] border border-dashed border-line-heavy px-2.5 py-2">
      <span className="text-[12px] font-medium text-ink-2">{messages().nodes.notUsedBy}{' '}{kindInfo?.displayName ?? node.kind}</span>
      {unusedKeys.map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="font-medium text-ink">{propertyLabel(key, {})}</span>
            <span className="truncate text-muted">{previewValue(node.config[key])}</span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {emptyTargets.length > 0 && (
              <SelectInput
                ariaLabel={messages().nodes.useKeyAs(key)}
                className="h-7 w-auto text-[12px]"
                value=""
                disabled={readOnly}
                options={emptyTargets.map(([name, property]) => ({ value: name, label: messages().nodes.useAsLowercase(propertyLabel(name, property).toLowerCase()) }))}
                onChange={(target) => {
                  if (!target) return
                  updateConfig(({ [key]: moved, ...rest }) => ({ ...rest, [target]: moved }), messages().nodes.usedKeyAsTarget(key, target))
                }}
              />
            )}
            <button
              type="button"
              className={linkButtonClassName}
              disabled={readOnly}
              onClick={() =>
                updateConfig(({ [key]: _removed, ...rest }) => rest, messages().nodes.removedKey(key))
              }
            >
              {messages().nodes.remove}{' '}{propertyLabel(key, {}).toLowerCase()}
            </button>
          </span>
        </div>
      ))}
      <p className={hintClassName}>{messages().nodes.keptWithTheStepSoSwitching}</p>
    </div>
  )
}

/** Settings of a plugin action step. */
export function PluginActionPanel() {
  const { node, kindInfo, nodeKinds, kindsByKind, updateNode, setConfigValue } = useInspector()
  const [lastChange, setLastChange] = useState<ActionChange | null>(null)
  const pluginName = kindInfo?.plugin?.name ?? node.plugin ?? ''
  const actions = listPluginActions(nodeKinds, pluginName)
  const unusedKeys = listUnusedConfigKeys(node.config, kindInfo, lastChange !== null)
  const notes = Object.fromEntries((lastChange?.keptKeys ?? []).map((key) => [key, messages().nodes.keptBothActionsUseIt]))

  const changeAction = (toKindInfo: NodeKindInfo) => {
    const change = planActionChange(node.config, node.kind, toKindInfo)
    updateNode({ kind: toKindInfo.kind }, messages().nodes.changedTheActionToDisplayname(toKindInfo.displayName))
    setLastChange(change)
  }
  const undoChange = () => {
    if (!lastChange) return
    updateNode({ kind: lastChange.fromKind, config: lastChange.fromConfig }, messages().nodes.changedTheActionBackToValue(kindsByKind[lastChange.fromKind]?.displayName ?? lastChange.fromKind))
    setLastChange(null)
  }

  return (
    <>
      {kindInfo && <PluginSetupStatus kindInfo={kindInfo} />}
      <ChangeActionField actions={actions.length > 0 ? actions : kindInfo ? [kindInfo] : []} onChangeAction={changeAction} />
      {lastChange && (
        <p className="m-0 text-[12px] text-muted">
          {messages().nodes.changedFrom}{' '}{kindsByKind[lastChange.fromKind]?.displayName ?? lastChange.fromKind} ·{' '}
          <button type="button" className={linkButtonClassName} onClick={undoChange}>
            {messages().nodes.undo}
          </button>
        </p>
      )}
      <InspectorSection title={messages().nodes.inputs} sectionKey="inputs">
        <SchemaForm
          schema={kindInfo?.configSchema}
          config={node.config as JsonObject}
          requiredMessage={messages().nodes.neededByValue(kindInfo?.displayName ?? node.kind)}
          notes={notes}
          onChange={(name, value) => setConfigValue([name], value, messages().nodes.setName(name))}
        />
        <NotUsedBox unusedKeys={unusedKeys} />
      </InspectorSection>
    </>
  )
}
