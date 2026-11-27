import { useState } from 'react'
import { checkOllama, setDefaultModel } from '@/api/credentials'
import type { ModelChoice, OllamaCheck } from '@/api/types'
import { InstallPageLink } from '@/components/InstallPageLink'
import { Badge, Button, joinClassNames, type BadgeTone } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { describeModelName, recommendedModelFor } from '@/lib/modelChoices'
import { ollamaDownloadUrl } from '@/pages/welcome/WelcomeChoiceDetails'
import { cardStateClassNames, ConnectionCardFooter } from './ConnectionCard'
import type { ModelConnection } from './modelConnections'
import { messages } from '@/i18n'

/** What the card says about Ollama: a short status, and one line on what to do next. */
export interface OllamaCardStatus {
  label: string
  tone: BadgeTone
  /** What was found and, when Ollama cannot be used yet, the next step in plain words. */
  detail: string
  /** True when agents can think with Ollama right now: it runs and has a model. */
  isUsable: boolean
  /** True when the app was not found, so the download link helps. */
  offersDownload: boolean
}

/**
 * Turns a check result into what the card shows. Null `check` means it is still being
 * checked; `checkError` is a failed check (not a missing Ollama, which is an answer).
 *
 * @param check - From `checkOllama`, null while checking (OllamaCheck | null)
 * @param checkError - Why the check itself failed, if it did (Error | null)
 * @returns Label, tone, detail and what the card may offer (OllamaCardStatus)
 *
 * @example
 * describeOllamaStatus({ state: 'installed_not_running', baseUrl: 'http://localhost:11434', models: [] }, null).label // 'Not running'
 */
export function describeOllamaStatus(check: OllamaCheck | null, checkError: Error | null): OllamaCardStatus {
  const t = messages().connections
  const unusable = { isUsable: false, offersDownload: false }
  if (checkError) return { ...unusable, label: t.ollamaCouldNotCheck, tone: 'neutral', detail: t.ollamaCheckFailed(describeError(checkError)) }
  if (!check) return { ...unusable, label: t.checking, tone: 'neutral', detail: t.ollamaChecking }
  if (check.state === 'not_found') return { ...unusable, label: t.ollamaNotFound, tone: 'neutral', detail: t.ollamaNotFoundSteps, offersDownload: true }
  if (check.state === 'installed_not_running') return { ...unusable, label: t.ollamaNotRunning, tone: 'amber', detail: t.ollamaInstalledNotRunning }
  if (check.models.length === 0) return { ...unusable, label: t.ollamaNoModelYet, tone: 'amber', detail: t.ollamaRunningWithoutModels }
  return { label: t.ollamaRunning, tone: 'ok', detail: t.ollamaRunningWithModels(check.models.length), isUsable: true, offersDownload: false }
}

/**
 * The model "Use by default" picks: the first one Ollama has. The check lists the largest
 * model first, and a larger model builds and runs agents more reliably. Without any model
 * it is the one the app tells people to download.
 *
 * @param models - Model names from the check, largest first (string[])
 * @returns The model to make the default (ModelChoice)
 *
 * @example
 * pickOllamaModel(['qwen2.5:14b', 'llama3.2:latest']) // { provider: 'ollama', name: 'qwen2.5:14b' }
 */
export function pickOllamaModel(models: string[]): ModelChoice {
  const [strongest] = models
  return strongest ? { provider: 'ollama', name: strongest } : recommendedModelFor('ollama')
}

interface OllamaCardProps {
  connection: ModelConnection
  /** The model new agents use, or null while no model is connected yet. */
  defaultModel: ModelChoice | null
  /** Reloads provider statuses and the default model after Ollama became the default. */
  onChanged: () => Promise<void>
}

/**
 * Ollama on the AI models tab. The backend always reports Ollama as set up (it needs no
 * key), so this card checks for real when it appears: running, installed but not running,
 * or not found, each with the next step in plain words. "Use by default" is offered only
 * when Ollama runs and has a model. The check does not block the rest of the tab.
 */
export function OllamaCard({ connection, defaultModel, onChanged }: OllamaCardProps) {
  const t = messages().connections
  const checkState = useAsyncData(checkOllama, [])
  const [isMakingDefault, setIsMakingDefault] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isChecking = checkState.isLoading
  // While checking again, the previous answer would be stale: show "Checking…" instead.
  const status = describeOllamaStatus(isChecking ? null : checkState.data, isChecking ? null : checkState.error)
  const isDefault = connection.state === 'default'
  const models = checkState.data?.models ?? []

  async function makeDefault() {
    setIsMakingDefault(true)
    setErrorMessage(null)
    try {
      await setDefaultModel(pickOllamaModel(models))
      await onChanged()
    } catch (defaultError) {
      setErrorMessage(t.couldNotMakeNameTheDefault(connection.name, describeError(defaultError)))
    } finally {
      setIsMakingDefault(false)
    }
  }

  return (
    <div className={joinClassNames('flex h-full min-w-0 flex-col gap-2 rounded-[14px] border p-4', cardStateClassNames[isDefault ? 'default' : 'available'])}>
      <div className="flex items-start justify-between gap-2">
        <b className="min-w-0 text-[14px] font-semibold [overflow-wrap:anywhere]">{connection.name}</b>
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          {isDefault && <Badge tone="brand">{t.default}</Badge>}
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      </div>
      <p aria-live="polite" className="m-0 text-[13px] leading-normal text-body">
        {status.detail}
      </p>
      {isDefault && defaultModel && <p className="m-0 text-[12px] leading-normal text-muted">{t.ollamaDefaultModelName(describeModelName(defaultModel))}</p>}
      {status.offersDownload && (
        <p className="m-0 text-[13px]">
          <InstallPageLink provider="ollama" url={ollamaDownloadUrl} label={t.downloadOllama} />
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] leading-normal text-danger">
          {errorMessage}
        </p>
      )}
      <ConnectionCardFooter>
        {status.isUsable && !isDefault && (
          <Button size="sm" variant="secondary" aria-label={t.useNameByDefault(connection.name)} onClick={() => void makeDefault()} disabled={isMakingDefault}>
            {isMakingDefault ? t.saving : t.useByDefault}
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-label={t.checkOllamaAgain} onClick={() => void checkState.reload()} disabled={isChecking} className="ml-auto">
          {isChecking ? t.checking : t.checkAgain}
        </Button>
      </ConnectionCardFooter>
    </div>
  )
}
