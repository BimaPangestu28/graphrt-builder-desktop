import { useEffect, useRef } from 'react'

/** How close to the bottom (px) still counts as "reading the latest". */
const NEAR_BOTTOM_PX = 80

/**
 * Keeps a scrolling chat pinned to its newest content: when anything inside changes (a new
 * message, streamed text) and the reader was at the bottom, it scrolls to the bottom again.
 * Scrolling up to read older messages stops the following until the reader scrolls back down.
 *
 * @returns A ref for the scrolling element (HTMLDivElement)
 *
 * @example
 * const chatBodyRef = useFollowNewContent()
 * return <div ref={chatBodyRef} className="overflow-y-auto">…</div>
 */
export function useFollowNewContent() {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return
    let isFollowing = true
    const handleScroll = () => {
      const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight
      isFollowing = distanceFromBottom <= NEAR_BOTTOM_PX
    }
    const contentObserver = new MutationObserver(() => {
      if (isFollowing) scrollContainer.scrollTop = scrollContainer.scrollHeight
    })
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    contentObserver.observe(scrollContainer, { childList: true, subtree: true, characterData: true })
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      contentObserver.disconnect()
    }
  }, [])

  return scrollContainerRef
}
