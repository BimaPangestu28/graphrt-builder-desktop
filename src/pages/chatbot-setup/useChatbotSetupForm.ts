import { useCallback, useEffect, useState } from 'react'
import { attachChatbotKnowledge, detachChatbotKnowledge, getChatbotSetup, saveChatbotSettings } from '@/api/chatbotSetup'
import type { ChatbotSettings, ChatbotSetup } from '@/api/chatbotSetupTypes'
import { getKnowledgeBase, listKnowledgeBases } from '@/api/knowledge'
import type { KnowledgeBase, KnowledgeBaseDetail } from '@/api/knowledgeTypes'

function toErrorMessage(rawError: unknown): string {
  return rawError instanceof Error ? rawError.message : 'Something went wrong'
}

/** Same persona, rules and channels (knowledge is saved on its own, at once). */
function hasSameFormFields(first: ChatbotSettings, second: ChatbotSettings): boolean {
  const formFields = (settings: ChatbotSettings) => JSON.stringify([settings.persona, settings.handoffRules, [...settings.disabledChannels].sort()])
  return formFields(first) === formFields(second)
}

/** Details of the attached knowledge bases; one that no longer exists is skipped. */
async function loadAttachedKnowledge(knowledgeBaseIds: string[]): Promise<KnowledgeBaseDetail[]> {
  const details = await Promise.all(knowledgeBaseIds.map((knowledgeBaseId) => getKnowledgeBase(knowledgeBaseId).catch(() => null)))
  return details.filter((detail): detail is KnowledgeBaseDetail => detail !== null)
}

export interface ChatbotSetupForm {
  savedSetup: ChatbotSetup | null
  draft: ChatbotSettings | null
  attachedKnowledge: KnowledgeBaseDetail[]
  availableKnowledge: KnowledgeBase[]
  isDirty: boolean
  isBusy: boolean
  error: string | null
  /** Shown after a save: the bot uses the new setup from its next reply. */
  hasJustSaved: boolean
  setDraft: (settings: ChatbotSettings) => void
  save: () => Promise<void>
  attach: (knowledgeBaseId: string) => Promise<void>
  detach: (knowledgeBaseId: string) => Promise<void>
}

/**
 * Loads a chatbot's setup and keeps an editable draft of the persona, rules and channels.
 * Saving sends the draft; attaching or detaching knowledge is saved at once and keeps
 * unsaved edits in the draft.
 */
export function useChatbotSetupForm(agentId: string): ChatbotSetupForm {
  const [savedSetup, setSavedSetup] = useState<ChatbotSetup | null>(null)
  const [draft, setDraftState] = useState<ChatbotSettings | null>(null)
  const [attachedKnowledge, setAttachedKnowledge] = useState<KnowledgeBaseDetail[]>([])
  const [allKnowledge, setAllKnowledge] = useState<KnowledgeBase[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasJustSaved, setHasJustSaved] = useState(false)

  const showKnowledge = useCallback(async (knowledgeBaseIds: string[]) => {
    const [details, knowledgeBases] = await Promise.all([loadAttachedKnowledge(knowledgeBaseIds), listKnowledgeBases()])
    setAttachedKnowledge(details)
    setAllKnowledge(knowledgeBases)
  }, [])

  useEffect(() => {
    let isCurrent = true
    setSavedSetup(null)
    setDraftState(null)
    setError(null)
    getChatbotSetup(agentId)
      .then(async (setup) => {
        if (!isCurrent) return
        setSavedSetup(setup)
        setDraftState(setup.settings)
        await showKnowledge(setup.settings.knowledgeBaseIds)
      })
      .catch((rawError: unknown) => {
        if (isCurrent) setError(toErrorMessage(rawError))
      })
    return () => {
      isCurrent = false
    }
  }, [agentId, showKnowledge])

  async function runChange(change: () => Promise<ChatbotSetup>, keepDraftEdits: boolean) {
    setIsBusy(true)
    setError(null)
    try {
      const setup = await change()
      setSavedSetup(setup)
      setDraftState((current) => (keepDraftEdits && current ? { ...current, knowledgeBaseIds: setup.settings.knowledgeBaseIds } : setup.settings))
      setHasJustSaved(!keepDraftEdits)
      await showKnowledge(setup.settings.knowledgeBaseIds)
    } catch (rawError) {
      setError(toErrorMessage(rawError))
    } finally {
      setIsBusy(false)
    }
  }

  const attachedIds = new Set(savedSetup?.settings.knowledgeBaseIds ?? [])
  return {
    savedSetup,
    draft,
    attachedKnowledge,
    availableKnowledge: allKnowledge.filter((knowledgeBase) => !attachedIds.has(knowledgeBase.id)),
    isDirty: Boolean(draft && savedSetup && (!savedSetup.isSaved || !hasSameFormFields(draft, savedSetup.settings))),
    isBusy,
    error,
    hasJustSaved,
    setDraft: (settings) => {
      setDraftState(settings)
      setHasJustSaved(false)
    },
    save: () => (draft ? runChange(() => saveChatbotSettings(agentId, draft), false) : Promise.resolve()),
    attach: (knowledgeBaseId) => runChange(() => attachChatbotKnowledge(agentId, knowledgeBaseId), true),
    detach: (knowledgeBaseId) => runChange(() => detachChatbotKnowledge(agentId, knowledgeBaseId), true),
  }
}
