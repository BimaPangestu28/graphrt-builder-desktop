import { useEffect, useRef, type DependencyList } from 'react'
import { countConversations, getConversation, listConversations, subscribeToConversationEvents } from '@/api/conversations'
import type { Conversation, ConversationCounts, ConversationDetail, ConversationEventPayload, ConversationFilter } from '@/api/conversationTypes'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/**
 * Calls `onConversationEvent` for every live `conversation-event` until unmount.
 *
 * @param onConversationEvent - Handler; the latest one is always used ((payload) => void)
 */
export function useConversationEvents(onConversationEvent: (payload: ConversationEventPayload) => void): void {
  const handlerRef = useRef(onConversationEvent)
  handlerRef.current = onConversationEvent
  useEffect(() => {
    let isSubscribed = true
    let unsubscribe: (() => void) | null = null
    subscribeToConversationEvents((payload) => handlerRef.current(payload))
      .then((stopListening) => {
        if (isSubscribed) unsubscribe = stopListening
        else stopListening()
      })
      .catch((subscribeError: unknown) => console.error('Could not follow conversation events', subscribeError))
    return () => {
      isSubscribed = false
      unsubscribe?.()
    }
  }, [])
}

/**
 * Loads conversation data and loads it again after every conversation event, so screens stay live.
 *
 * @param loadData - Async loader (() => Promise<Data>)
 * @param dependencies - Values the loader reads (DependencyList)
 * @param isRelevant - Which events trigger a reload; all by default ((payload) => boolean)
 */
function useLiveConversationData<Data>(
  loadData: () => Promise<Data>,
  dependencies: DependencyList,
  isRelevant: (payload: ConversationEventPayload) => boolean = () => true,
): AsyncDataState<Data> {
  const state = useAsyncData(loadData, dependencies)
  useConversationEvents((payload) => {
    if (isRelevant(payload)) void state.reload()
  })
  return state
}

/** Conversations matching `filter`, most recently active first, kept live. */
export function useConversationList(filter: ConversationFilter): AsyncDataState<Conversation[]> {
  const { status, agentId, origin, channel, limit } = filter
  return useLiveConversationData(() => listConversations({ status, agentId, origin, channel, limit }), [status, agentId, origin, channel, limit])
}

/** Counts per Inbox chip (all agents when `agentId` is undefined), kept live. */
export function useConversationCounts(agentId?: string): AsyncDataState<ConversationCounts> {
  return useLiveConversationData(() => countConversations(agentId), [agentId])
}

/** One conversation with its messages, kept live; nothing is loaded while `conversationId` is null. */
export function useConversationDetail(conversationId: string | null): AsyncDataState<ConversationDetail | null> {
  return useLiveConversationData(
    () => (conversationId ? getConversation(conversationId) : Promise.resolve(null)),
    [conversationId],
    (payload) => payload.conversationId === conversationId,
  )
}
