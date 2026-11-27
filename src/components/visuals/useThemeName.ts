import { useSyncExternalStore } from 'react'

export type ThemeName = 'light' | 'dark'

/** The app theme: `data-theme="dark"` on the root element, light otherwise (see `src/lib/appearance.ts`). */
export function readThemeName(): ThemeName {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/**
 * The current app theme, re-rendering when it changes. CSS follows the theme by itself (the tokens in
 * `index.css`); this is for the few things drawn from JavaScript, such as diagrams.
 */
export function useThemeName(): ThemeName {
  return useSyncExternalStore(subscribe, readThemeName, () => 'light')
}
