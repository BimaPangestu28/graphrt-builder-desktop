import { useEffect, useState } from 'react'
import { getKnowledgeBase, listKnowledgeBases, searchKnowledge, subscribeToKnowledgeEvents } from '@/api/knowledge'
import type { KnowledgeBase, KnowledgeBaseDetail, KnowledgeEvent, KnowledgePassage } from '@/api/knowledgeTypes'
import { useLoadedData, type LoadedData } from './useRunData'
import { toError } from '@/lib/errors'

/** Delay before searching while the user types. */
export const KNOWLEDGE_SEARCH_DELAY_MS = 200

/** Keeps a callback subscribed to `knowledge-event` while the component is mounted. */
function useKnowledgeEvents(onKnowledgeEvent: (event: KnowledgeEvent) => void): void {
  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let isMounted = true
    void subscribeToKnowledgeEvents(onKnowledgeEvent).then((stop) => {
      if (isMounted) unsubscribe = stop
      else stop()
    })
    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [onKnowledgeEvent])
}

function replaceKnowledgeBase(knowledgeBases: KnowledgeBase[] | null, changed: KnowledgeBase): KnowledgeBase[] | null {
  if (!knowledgeBases) return knowledgeBases
  const isKnown = knowledgeBases.some((knowledgeBase) => knowledgeBase.id === changed.id)
  return isKnown ? knowledgeBases.map((knowledgeBase) => (knowledgeBase.id === changed.id ? changed : knowledgeBase)) : [changed, ...knowledgeBases]
}

function markSyncing(knowledgeBase: KnowledgeBase): KnowledgeBase {
  return { ...knowledgeBase, status: 'syncing', syncProgress: knowledgeBase.syncProgress ?? { done: 0, total: knowledgeBase.sourceCount } }
}

/**
 * Every knowledge base, kept current by `knowledge-event`s (sync start and end).
 *
 * @returns The list and its load state; `setData` adds or replaces bases locally (LoadedData<KnowledgeBase[]>)
 */
export function useKnowledgeBases(): LoadedData<KnowledgeBase[]> {
  const loaded = useLoadedData(listKnowledgeBases, [])
  const { setData } = loaded
  const [onKnowledgeEvent] = useState(() => (event: KnowledgeEvent) => {
    if (event.type === 'sync_finished') setData((current) => replaceKnowledgeBase(current, event.knowledgeBase))
    if (event.type === 'sync_started') {
      setData((current) => current?.map((knowledgeBase) => (knowledgeBase.id === event.knowledgeBaseId ? markSyncing(knowledgeBase) : knowledgeBase)) ?? null)
    }
  })
  useKnowledgeEvents(onKnowledgeEvent)
  return loaded
}

/** One knowledge base with live source statuses. */
export interface LiveKnowledgeBase extends LoadedData<KnowledgeBaseDetail> {
  /** Reading progress (0 to 100) of sources being read, by source id. */
  readingPercents: Record<string, number>
}

function applyEventToDetail(detail: KnowledgeBaseDetail | null, event: KnowledgeEvent): KnowledgeBaseDetail | null {
  if (!detail || event.knowledgeBaseId !== detail.knowledgeBase.id) return detail
  switch (event.type) {
    case 'sync_started':
      return { ...detail, knowledgeBase: markSyncing(detail.knowledgeBase) }
    case 'sync_finished':
      return { ...detail, knowledgeBase: event.knowledgeBase }
    case 'source_updated': {
      const isKnown = detail.sources.some((source) => source.id === event.source.id)
      const sources = isKnown ? detail.sources.map((source) => (source.id === event.source.id ? event.source : source)) : [...detail.sources, event.source]
      // A source finished (no percent): one more done in the running sync's progress.
      const progress = detail.knowledgeBase.syncProgress
      const isSourceDone = event.progressPercent === null && detail.knowledgeBase.status === 'syncing' && progress !== null
      const knowledgeBase = isSourceDone ? { ...detail.knowledgeBase, syncProgress: { ...progress, done: Math.min(progress.done + 1, progress.total) } } : detail.knowledgeBase
      return { ...detail, sources, knowledgeBase }
    }
  }
}

/**
 * Loads a knowledge base and its sources, then follows `knowledge-event`s so
 * statuses move from reading to indexed (or failed) without reloading.
 *
 * @param knowledgeBaseId - Which knowledge base (string)
 */
export function useKnowledgeBaseDetail(knowledgeBaseId: string): LiveKnowledgeBase {
  const loaded = useLoadedData(() => getKnowledgeBase(knowledgeBaseId), [knowledgeBaseId])
  const { setData } = loaded
  const [readingPercents, setReadingPercents] = useState<Record<string, number>>({})
  const [onKnowledgeEvent] = useState(() => (event: KnowledgeEvent) => {
    setData((current) => applyEventToDetail(current, event))
    if (event.type === 'source_updated') {
      setReadingPercents((current) => ({ ...current, [event.source.id]: event.progressPercent ?? 0 }))
    }
  })
  useKnowledgeEvents(onKnowledgeEvent)
  return { ...loaded, readingPercents }
}

/** Search results for the text in a search box. */
export interface KnowledgeSearchState {
  passages: KnowledgePassage[]
  isSearching: boolean
  error: Error | null
}

/**
 * Searches as the user types (after {@link KNOWLEDGE_SEARCH_DELAY_MS}); answers for
 * older text are dropped. A blank query clears the results without searching.
 *
 * @param query - Search text (string)
 * @param knowledgeBaseIds - Limit to these knowledge bases; all when omitted (string[])
 * @param limit - Most passages (number)
 */
export function useKnowledgeSearch(query: string, knowledgeBaseIds?: string[], limit = 4): KnowledgeSearchState {
  const [state, setState] = useState<KnowledgeSearchState>({ passages: [], isSearching: false, error: null })
  const idsKey = knowledgeBaseIds?.join('\n') ?? ''

  useEffect(() => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      setState({ passages: [], isSearching: false, error: null })
      return
    }
    let isCurrent = true
    setState((current) => ({ ...current, isSearching: true }))
    const ids = idsKey ? idsKey.split('\n') : undefined
    const timer = setTimeout(() => {
      searchKnowledge(trimmedQuery, ids, limit)
        .then((passages) => {
          if (isCurrent) setState({ passages, isSearching: false, error: null })
        })
        .catch((searchError: unknown) => {
          if (isCurrent) setState({ passages: [], isSearching: false, error: toError(searchError) })
        })
    }, KNOWLEDGE_SEARCH_DELAY_MS)
    return () => {
      isCurrent = false
      clearTimeout(timer)
    }
  }, [query, idsKey, limit])

  return state
}
