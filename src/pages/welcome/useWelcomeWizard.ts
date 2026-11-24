import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAppSettings } from '@/api/appSettings'
import { listAvailableModels, listProviderStatuses } from '@/api/credentials'
import type { ProviderModels } from '@/api/modelCatalogTypes'
import type { LocalCliProvider } from '@/api/types'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { pathAfterWelcome, saveWelcomeSetup, type ApiKeyProvider } from './welcomeSetup'
import {
  canLeaveStep,
  nextStepId,
  previousStepId,
  recommendApproach,
  recommendedTool,
  welcomeChoiceFor,
  wizardStepsFor,
  type WizardAnswers,
  type WizardApproach,
  type WizardDetection,
  type WizardStepId,
} from './welcomeWizard'

/** True once Ollama answered with a model list; null while asking. */
function isOllamaRunning(catalog: ProviderModels[] | null, isLoading: boolean): boolean | null {
  if (isLoading && !catalog) return null
  const ollamaList = catalog?.find((list) => list.provider === 'ollama')
  return Boolean(ollamaList && !ollamaList.error)
}

/** Detection for the wizard: provider statuses (local CLIs) and whether Ollama runs, with "check again". */
function useWizardDetection() {
  const statusesState = useAsyncData(() => listProviderStatuses(), [])
  const [refreshCount, setRefreshCount] = useState(0)
  const catalogState = useAsyncData(() => listAvailableModels(refreshCount > 0), [refreshCount])
  const detection: WizardDetection = {
    statuses: statusesState.data,
    isOllamaRunning: isOllamaRunning(catalogState.data, catalogState.isLoading),
  }
  return { detection, isCheckingOllama: catalogState.isLoading, checkOllamaAgain: () => setRefreshCount((count) => count + 1) }
}

/**
 * State of the Welcome wizard: the current step, the answers (with the recommended approach
 * and tool filled in until the user picks their own), the background preference and saving.
 * Finish saves everything with `saveWelcomeSetup` and opens the next screen.
 */
export function useWelcomeWizard() {
  const navigate = useNavigate()
  const { detection, isCheckingOllama, checkOllamaAgain } = useWizardDetection()
  const appSettingsState = useAsyncData(() => getAppSettings(), [])

  const [stepId, setStepId] = useState<WizardStepId>('welcome')
  const [pickedApproach, setApproach] = useState<WizardApproach | null>(null)
  const [pickedTool, setTool] = useState<LocalCliProvider | null>(null)
  const [apiKeyProvider, setApiKeyProvider] = useState<ApiKeyProvider>('openai')
  const [apiKey, setApiKey] = useState('')
  const [pickedKeepRunning, setKeepRunningInBackground] = useState<boolean | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)

  const recommendedApproach = recommendApproach(detection)
  const answers: WizardAnswers = {
    approach: pickedApproach ?? recommendedApproach,
    tool: pickedTool ?? recommendedTool(detection.statuses),
    apiKeyProvider,
    apiKey,
  }
  // Until the user decides, follow the current setting (on by default, like Settings).
  const keepRunningInBackground = pickedKeepRunning ?? appSettingsState.data?.showInMenuBar ?? true
  const steps = wizardStepsFor(answers.approach)
  const canGoNext = canLeaveStep(stepId, answers, detection.statuses) && !isSaving

  function goNext() {
    if (!canGoNext) return
    // Keep the recommended answers the user went on with, so a later detection result
    // (e.g. Ollama answering after "Check again") cannot change them behind their back.
    if (pickedApproach === null) setApproach(answers.approach)
    if (pickedTool === null && stepId === 'setup') setTool(answers.tool)
    const nextId = nextStepId(steps, stepId)
    if (nextId) setStepId(nextId)
  }

  function goBack() {
    if (isSaving) return
    setSaveErrorMessage(null)
    const previousId = previousStepId(steps, stepId)
    if (previousId) setStepId(previousId)
  }

  async function finish() {
    const choice = welcomeChoiceFor(answers)
    if (!choice || isSaving) return
    setIsSaving(true)
    setSaveErrorMessage(null)
    try {
      await saveWelcomeSetup({ choice, apiKeyProvider, apiKey, keepRunningInBackground })
      navigate(pathAfterWelcome(choice))
    } catch (saveError) {
      setSaveErrorMessage(`Could not save your setup: ${describeError(saveError)}`)
      setIsSaving(false)
    }
  }

  return {
    stepId,
    steps,
    answers,
    detection,
    recommendedApproach,
    isCheckingOllama,
    checkOllamaAgain,
    keepRunningInBackground,
    isSaving,
    saveErrorMessage,
    canGoNext,
    goNext,
    goBack,
    finish,
    setApproach,
    setTool,
    setApiKeyProvider,
    setApiKey,
    setKeepRunningInBackground,
  }
}

export type WelcomeWizard = ReturnType<typeof useWelcomeWizard>
