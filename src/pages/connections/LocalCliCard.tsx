import { useState } from 'react'
import { checkLocalCli, listProviderStatuses, setDefaultModel, setLocalCliEnabled } from '@/api/credentials'
import type { AvailableModel } from '@/api/modelCatalogTypes'
import type { LocalCliCheckResult, LocalCliProvider, LocalCliStatus, ModelChoice } from '@/api/types'
import { InstallPageLink } from '@/components/InstallPageLink'
import { Badge, Button, joinClassNames, StatusDot, type BadgeTone, type StatusDotTone } from '@/components/ui'
import { describeLocalCliUsageNote, localCliDefaultModelName, localCliShortNames } from '@/data/settings'
import { describeError } from '@/lib/agentDisplay'
import { describeLocalCliDetection, describeLocalCliSignIn, type LocalCliHintTone } from '@/lib/localCliDisplay'
import { describeModelName } from '@/lib/modelChoices'
import { cardStateClassNames, ConnectionCardFooter, statusBadgeTones } from './ConnectionCard'
import type { ModelConnection } from './modelConnections'

type CardAction = 'turnOn' | 'turnOff' | 'makeDefault' | 'check' | 'detect' | 'pickModel'

interface LocalCliCardProps {
  connection: ModelConnection
  provider: LocalCliProvider
  localCli: LocalCliStatus
  defaultModel: ModelChoice
  /** This CLI's models from `listAvailableModels`, or null while loading / when off. */
  models: AvailableModel[] | null
  /** Reloads provider statuses and the default model after a change. */
  onChanged: () => Promise<void>
}

const hintDotTones: Record<LocalCliHintTone, StatusDotTone> = { ok: 'ok', amber: 'amber', muted: 'paused' }

function describeCardStatus(connection: ModelConnection, localCli: LocalCliStatus): { label: string; tone: BadgeTone } {
  if (connection.state !== 'available') return { label: connection.connectedLabel, tone: statusBadgeTones[connection.state] }
  return { label: localCli.installed ? 'Off' : 'Not installed', tone: 'neutral' }
}

/** The CLI's models as select options, "CLI default" first; just "CLI default" until the list arrives. */
function listModelOptions(provider: LocalCliProvider, models: AvailableModel[] | null): Array<{ name: string; label: string }> {
  const listedModels = (models ?? []).filter((model) => model.id !== localCliDefaultModelName)
  const defaultOption = { name: localCliDefaultModelName, label: describeModelName({ provider, name: localCliDefaultModelName }) }
  return [defaultOption, ...listedModels.map((model) => ({ name: model.id, label: model.displayName ?? model.id }))]
}

/**
 * Hook holding a CLI card's busy action, inline messages and the model picked before
 * "Use by default", plus a runner that reports failures in plain words.
 */
function useCardActions() {
  const [busyAction, setBusyAction] = useState<CardAction | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<LocalCliCheckResult | null>(null)

  async function runAction(action: CardAction, failurePrefix: string, work: () => Promise<void>) {
    setBusyAction(action)
    setErrorMessage(null)
    try {
      await work()
    } catch (actionError) {
      setErrorMessage(`${failurePrefix}: ${describeError(actionError)}`)
    } finally {
      setBusyAction(null)
    }
  }
  return { busyAction, errorMessage, checkResult, setCheckResult, runAction }
}

/**
 * One local CLI provider (Claude Code or Codex on this computer) on the AI models tab:
 * Experimental, opt-in. Shows what was detected (installed version or an install link,
 * the CLI's own sign-in state) and the plan-usage note; Turn on / Turn off, Check
 * connection (one tiny prompt, only on click), Use by default with a model choice, and
 * Detect again.
 */
export function LocalCliCard({ connection, provider, localCli, defaultModel, models, onChanged }: LocalCliCardProps) {
  const { busyAction, errorMessage, checkResult, setCheckResult, runAction } = useCardActions()
  const [pickedModelName, setPickedModelName] = useState(localCliDefaultModelName)
  const shortName = localCliShortNames[provider]
  const isOn = connection.state !== 'available'
  const isDefault = connection.state === 'default'
  const status = describeCardStatus(connection, localCli)
  const signInHint = describeLocalCliSignIn(provider, localCli)
  const selectedModelName = isDefault ? defaultModel.name : pickedModelName
  const modelOptions = listModelOptions(provider, models)
  const isListed = modelOptions.some((option) => option.name === selectedModelName)

  const turnOn = () => runAction('turnOn', `Could not turn on ${shortName}`, async () => {
    await setLocalCliEnabled(provider, true)
    await onChanged()
  })
  const turnOff = () => runAction('turnOff', `Could not turn off ${shortName}`, async () => {
    setCheckResult(null)
    await setLocalCliEnabled(provider, false)
    await onChanged()
  })
  const makeDefault = () => runAction('makeDefault', `Could not make ${shortName} the default`, async () => {
    await setDefaultModel({ provider, name: pickedModelName })
    await onChanged()
  })
  const checkConnection = () => runAction('check', `Could not check ${shortName}`, async () => {
    setCheckResult(null)
    setCheckResult(await checkLocalCli(provider))
  })
  const detectAgain = () => runAction('detect', `Could not look for ${shortName}`, async () => {
    await listProviderStatuses(true)
    await onChanged()
  })
  const pickModel = (modelName: string) => {
    if (!isDefault) return setPickedModelName(modelName)
    void runAction('pickModel', 'Could not change the model', async () => {
      await setDefaultModel({ provider, name: modelName })
      await onChanged()
    })
  }

  return (
    <div className={joinClassNames('flex h-full min-w-0 flex-col gap-2 rounded-[14px] border p-4', cardStateClassNames[connection.state])}>
      <div className="flex flex-col items-start gap-1.5">
        <b className="min-w-0 text-[14px] font-semibold [overflow-wrap:anywhere]">{connection.name}</b>
        <span className="flex flex-wrap gap-1">
          <Badge tone="amber">Experimental</Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      </div>
      <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-[13px] leading-normal text-body">
        <span>{describeLocalCliDetection(localCli)}</span>
        {!localCli.installed && (
          <>
            <span aria-hidden="true">·</span>
            <InstallPageLink provider={provider} url={localCli.installUrl} label={`How to install ${shortName}`} />
          </>
        )}
      </p>
      {signInHint && (
        <p className="m-0 flex items-center gap-1.5 text-[13px] text-ink-2">
          <StatusDot tone={hintDotTones[signInHint.tone]} />
          {signInHint.text}
        </p>
      )}
      <p className="m-0 text-[12px] leading-normal text-muted">{describeLocalCliUsageNote(provider)}</p>
      {isOn && (
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          {isDefault ? 'Model new agents use' : 'Model'}
          <select
            aria-label={`${shortName} model`}
            value={selectedModelName}
            disabled={busyAction !== null}
            onChange={(event) => pickModel(event.target.value)}
            className="box-border h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-2 text-[13px] font-normal text-ink"
          >
            {!isListed && <option value={selectedModelName}>{describeModelName({ provider, name: selectedModelName })}</option>}
            {modelOptions.map((option) => (
              <option key={option.name} value={option.name}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {checkResult && (
        <p aria-live="polite" className={joinClassNames('m-0 text-[13px] leading-normal', checkResult.ok ? 'text-ok-strong' : 'text-danger')}>
          {checkResult.message}
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] leading-normal text-danger">
          {errorMessage}
        </p>
      )}
      <ConnectionCardFooter>
        {!isOn && localCli.installed && (
          <Button size="sm" variant="secondary" aria-label={`Turn on ${shortName}`} onClick={() => void turnOn()} disabled={busyAction !== null}>
            {busyAction === 'turnOn' ? 'Turning on…' : 'Turn on'}
          </Button>
        )}
        {isOn && !isDefault && (
          <Button size="sm" variant="secondary" aria-label={`Use ${connection.name} by default`} onClick={() => void makeDefault()} disabled={busyAction !== null}>
            {busyAction === 'makeDefault' ? 'Saving…' : 'Use by default'}
          </Button>
        )}
        {isOn && (
          <Button size="sm" variant="ghost" aria-label={`Check ${shortName} connection`} onClick={() => void checkConnection()} disabled={busyAction !== null}>
            {busyAction === 'check' ? 'Checking…' : 'Check connection'}
          </Button>
        )}
        <span className="ml-auto flex items-center gap-1">
          {!isOn && (
            <Button size="sm" variant="ghost" aria-label={`Detect ${shortName} again`} onClick={() => void detectAgain()} disabled={busyAction !== null}>
              {busyAction === 'detect' ? 'Looking…' : 'Detect again'}
            </Button>
          )}
          {isOn && (
            <Button size="sm" variant="ghost" aria-label={`Turn off ${shortName}`} onClick={() => void turnOff()} disabled={busyAction !== null} className="!text-danger hover:!bg-danger-tint">
              {busyAction === 'turnOff' ? 'Turning off…' : 'Turn off'}
            </Button>
          )}
        </span>
      </ConnectionCardFooter>
    </div>
  )
}
