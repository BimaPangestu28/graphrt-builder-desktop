import { useCallback, useState } from 'react'

/**
 * Whether the builder chat is folded into a thin rail while the Nodes view is open
 * (spec A gives the canvas the room). The choice is remembered per viewer in
 * localStorage; storage can be missing or blocked, so every access is guarded and the
 * page works without it.
 */

/** localStorage key of the folded / open choice ("1" folded, "0" open). */
export const chatRailStorageKey = 'graphrt.builder.nodesChatCollapsed'

/** Windows narrower than this start with the chat folded when nothing was chosen yet. */
export const chatRailAutoCollapseWidth = 1320

/**
 * The stored choice, or null when there is none (or storage is unavailable).
 *
 * @returns True when folded, false when open, null when unknown (boolean | null)
 */
export function readChatRailPreference(): boolean | null {
  try {
    const storedValue = window.localStorage.getItem(chatRailStorageKey)
    if (storedValue === '1') return true
    if (storedValue === '0') return false
    return null
  } catch {
    return null
  }
}

/** Stores the choice; a blocked storage only means it is not remembered. */
export function writeChatRailPreference(isCollapsed: boolean): void {
  try {
    window.localStorage.setItem(chatRailStorageKey, isCollapsed ? '1' : '0')
  } catch {
    // Private windows and blocked site data: the choice lasts for this page only.
  }
}

/** The starting state: the stored choice, else folded on narrow windows. */
function initialChatRailState(): boolean {
  const storedPreference = readChatRailPreference()
  if (storedPreference !== null) return storedPreference
  return typeof window !== 'undefined' && window.innerWidth < chatRailAutoCollapseWidth
}

export interface ChatRailPreference {
  isCollapsed: boolean
  setCollapsed: (isCollapsed: boolean) => void
  toggle: () => void
}

/**
 * The Nodes view's chat fold state, remembered per viewer.
 *
 * @returns The state and setters (ChatRailPreference)
 */
export function useChatRailPreference(): ChatRailPreference {
  const [isCollapsed, setIsCollapsed] = useState(initialChatRailState)
  const setCollapsed = useCallback((nextIsCollapsed: boolean) => {
    setIsCollapsed(nextIsCollapsed)
    writeChatRailPreference(nextIsCollapsed)
  }, [])
  const toggle = useCallback(() => {
    setIsCollapsed((current) => {
      writeChatRailPreference(!current)
      return !current
    })
  }, [])
  return { isCollapsed, setCollapsed, toggle }
}
