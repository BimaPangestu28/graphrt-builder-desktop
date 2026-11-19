import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { builderAskParam } from '@/routes'

/** A change request handed to the builder through the URL, to prefill in its chat box. */
export interface BuilderAskDraft {
  text: string
  /** Changes on every new request, so the same text asked twice still prefills again. */
  sequence: number
}

/**
 * Takes the `ask` search param of the builder (see `builderAskParam`) once: returns it as a
 * draft for the chat box and removes it from the URL (replacing the history entry), so a
 * refresh or Back does not prefill again. The draft is never sent here.
 *
 * @returns The latest asked draft, or null when none was asked (BuilderAskDraft | null)
 */
export function useBuilderAskDraft(): BuilderAskDraft | null {
  const [searchParams, setSearchParams] = useSearchParams()
  const askedText = searchParams.get(builderAskParam)
  const [askDraft, setAskDraft] = useState<BuilderAskDraft | null>(null)

  useEffect(() => {
    if (askedText === null) return
    const trimmedText = askedText.trim()
    if (trimmedText) setAskDraft((current) => ({ text: trimmedText, sequence: (current?.sequence ?? 0) + 1 }))
    setSearchParams(
      (currentParams) => {
        const nextParams = new URLSearchParams(currentParams)
        nextParams.delete(builderAskParam)
        return nextParams
      },
      { replace: true },
    )
  }, [askedText, setSearchParams])

  return askDraft
}
