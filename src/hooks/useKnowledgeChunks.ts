import { useEffect, useState } from 'react'
import { KNOWLEDGE_CHUNK_PAGE_SIZE, listKnowledgeChunks, listKnowledgeDocuments } from '@/api/knowledge'
import type { KnowledgeChunkPage, KnowledgeDocument, KnowledgeSource } from '@/api/knowledgeTypes'
import { toError } from '@/lib/errors'

/** Delay before filtering passages while the user types. */
export const CHUNK_FILTER_DELAY_MS = 250

/** Documents of every indexed source of a knowledge base. */
export interface KnowledgeDocumentsState {
  documents: KnowledgeDocument[]
  isLoading: boolean
  error: Error | null
}

/** What changes when a source is indexed again; documents are reloaded when it does. */
function sourcesKey(sources: KnowledgeSource[]): string {
  return sources.map((source) => `${source.id}:${source.status}:${source.passageCount}:${source.lastSyncedAt ?? ''}`).join('|')
}

/**
 * Loads the documents of every source (in parallel), reloading when a source's status,
 * passage count or sync time changes.
 *
 * @param sources - The knowledge base's sources (KnowledgeSource[])
 */
export function useKnowledgeDocuments(sources: KnowledgeSource[]): KnowledgeDocumentsState {
  const [state, setState] = useState<KnowledgeDocumentsState>({ documents: [], isLoading: true, error: null })
  const key = sourcesKey(sources)
  const [currentSources, setCurrentSources] = useState(sources)
  if (sourcesKey(currentSources) !== key) setCurrentSources(sources)

  useEffect(() => {
    let isCurrent = true
    setState((current) => ({ ...current, isLoading: true }))
    Promise.all(currentSources.map((source) => listKnowledgeDocuments(source.id)))
      .then((perSource) => {
        if (isCurrent) setState({ documents: perSource.flat(), isLoading: false, error: null })
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setState({ documents: [], isLoading: false, error: toError(loadError) })
      })
    return () => {
      isCurrent = false
    }
  }, [currentSources])

  return state
}

export interface KnowledgeChunksState {
  page: KnowledgeChunkPage | null
  isLoading: boolean
  error: Error | null
}

/**
 * One page of a document's passages. The filter is applied after {@link CHUNK_FILTER_DELAY_MS};
 * answers for an older document, filter or offset are dropped.
 *
 * @param document - The document, or null when none is chosen
 * @param filter - Words every passage must contain (string)
 * @param offset - First passage among the matching ones (number)
 * @param refreshKey - Changes when the document was indexed again (string)
 */
export function useKnowledgeChunks(document: KnowledgeDocument | null, filter: string, offset: number, refreshKey: string): KnowledgeChunksState {
  const [state, setState] = useState<KnowledgeChunksState>({ page: null, isLoading: false, error: null })
  const sourceId = document?.sourceId ?? null
  const documentId = document?.documentId ?? null

  useEffect(() => {
    if (!sourceId || !documentId) {
      setState({ page: null, isLoading: false, error: null })
      return
    }
    let isCurrent = true
    setState((current) => ({ ...current, isLoading: true }))
    const timer = setTimeout(
      () => {
        listKnowledgeChunks(sourceId, documentId, filter.trim(), offset, KNOWLEDGE_CHUNK_PAGE_SIZE)
          .then((page) => {
            if (isCurrent) setState({ page, isLoading: false, error: null })
          })
          .catch((loadError: unknown) => {
            if (isCurrent) setState({ page: null, isLoading: false, error: toError(loadError) })
          })
      },
      filter.trim() ? CHUNK_FILTER_DELAY_MS : 0,
    )
    return () => {
      isCurrent = false
      clearTimeout(timer)
    }
  }, [sourceId, documentId, filter, offset, refreshKey])

  return state
}
