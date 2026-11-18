import type { ChatbotChannel, ChatbotSettings, ChatbotSetup } from '../chatbotSetupTypes'
import { sampleChatbotPersona, sampleHandoffRules } from '@/data/chatbotSetup'
import { sampleKnowledgeBackend } from './knowledge'
import { respondWith } from './sampleResponse'

/**
 * Sample chatbot setups for the browser preview and tests, kept in memory. The sample
 * "Catering assistant" is saved with the mockup's persona and answers from "Catering menu
 * and prices"; WhatsApp shows as connected so the preview looks like the design.
 * Call {@link resetSampleChatbotSetups} in tests to start from the seed.
 */

const sampleChatbotId = 'catering-assistant'

function buildSeedSettings(): Map<string, ChatbotSettings> {
  return new Map([
    [
      sampleChatbotId,
      {
        persona: { ...sampleChatbotPersona },
        handoffRules: { ...sampleHandoffRules },
        knowledgeBaseIds: ['menu-and-prices'],
        disabledChannels: [],
      },
    ],
  ])
}

let storedSettings = buildSeedSettings()

/** Puts the sample setups back to the seed. */
export function resetSampleChatbotSetups(): void {
  storedSettings = buildSeedSettings()
}

function describeChannels(settings: ChatbotSettings): ChatbotChannel[] {
  const isWhatsAppOn = !settings.disabledChannels.includes('whatsapp')
  return [
    { id: 'whatsapp', name: 'WhatsApp', connected: true, enabled: isWhatsAppOn, detail: '+62 8•• •••• 1204 · same number as outreach' },
    { id: 'telegram', name: 'Telegram', connected: false, enabled: false, detail: null },
  ]
}

function defaultSettings(): ChatbotSettings {
  return {
    persona: { displayName: '', tone: '', instructions: '' },
    handoffRules: { asksForPerson: true, notInKnowledge: true, orderReady: true, soundsUpset: true },
    knowledgeBaseIds: [],
    disabledChannels: [],
  }
}

function cloneSettings(settings: ChatbotSettings): ChatbotSettings {
  return JSON.parse(JSON.stringify(settings)) as ChatbotSettings
}

function readSetup(agentId: string): ChatbotSetup {
  const saved = storedSettings.get(agentId)
  const settings = cloneSettings(saved ?? defaultSettings())
  return { agentId, settings, isSaved: saved !== undefined, channels: describeChannels(settings) }
}

function saveSetup(agentId: string, settings: ChatbotSettings): ChatbotSetup {
  storedSettings.set(agentId, cloneSettings(settings))
  return readSetup(agentId)
}

export const sampleChatbotSetupBackend = {
  getChatbotSetup: (agentId: string): Promise<ChatbotSetup> => respondWith(() => readSetup(agentId)),
  saveChatbotSettings: (agentId: string, settings: ChatbotSettings): Promise<ChatbotSetup> => respondWith(() => saveSetup(agentId, settings)),
  attachChatbotKnowledge: async (agentId: string, knowledgeBaseId: string): Promise<ChatbotSetup> => {
    await sampleKnowledgeBackend.getKnowledgeBase(knowledgeBaseId)
    const settings = readSetup(agentId).settings
    const knowledgeBaseIds = settings.knowledgeBaseIds.includes(knowledgeBaseId) ? settings.knowledgeBaseIds : [...settings.knowledgeBaseIds, knowledgeBaseId]
    return saveSetup(agentId, { ...settings, knowledgeBaseIds })
  },
  detachChatbotKnowledge: (agentId: string, knowledgeBaseId: string): Promise<ChatbotSetup> =>
    respondWith(() => {
      const settings = readSetup(agentId).settings
      return saveSetup(agentId, { ...settings, knowledgeBaseIds: settings.knowledgeBaseIds.filter((attachedId) => attachedId !== knowledgeBaseId) })
    }),
}
