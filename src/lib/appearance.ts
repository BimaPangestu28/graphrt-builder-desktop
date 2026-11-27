import { appearanceKeys, type AppearanceKey } from './settings'
import type { ThemeName } from './useThemeName'

/**
 * The app's appearance: light or dark colours for the whole window.
 *
 * The app follows the operating system ("Match the system", the default) unless someone picks Light or Dark in
 * Settings > General. The choice lives in localStorage, so every window paints in the right colours before
 * anything else loads. The theme itself is `data-theme="dark"` on the root element (nothing for light): the
 * colour tokens in `index.css` follow it, and `useThemeName` reports it to the few things drawn from
 * JavaScript (diagrams, the canvas arrows).
 */

const APPEARANCE_STORAGE_KEY = 'graphrt.appearance'
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

/** Narrows a stored value to an appearance choice. */
export function parseAppearance(value: unknown): AppearanceKey | null {
  return appearanceKeys.find((key) => key === value) ?? null
}

/** The stored choice; "Match the system" when nothing (or nothing valid) is stored. */
export function readStoredAppearance(): AppearanceKey {
  try {
    return parseAppearance(globalThis.localStorage?.getItem(APPEARANCE_STORAGE_KEY)) ?? 'system'
  } catch {
    return 'system'
  }
}

function storeAppearance(appearance: AppearanceKey): void {
  try {
    globalThis.localStorage?.setItem(APPEARANCE_STORAGE_KEY, appearance)
  } catch {
    // Storage can be unavailable (private window, tests): the choice then lasts until the window closes.
  }
}

function systemDarkQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(SYSTEM_DARK_QUERY) : null
}

/**
 * The theme an appearance choice means right now.
 *
 * @param appearance - The Settings > General choice ('system' | 'light' | 'dark')
 * @param systemPrefersDark - Whether the operating system is in dark mode (boolean)
 * @returns The theme to paint (ThemeName)
 */
export function resolveTheme(appearance: AppearanceKey, systemPrefersDark: boolean): ThemeName {
  if (appearance === 'system') return systemPrefersDark ? 'dark' : 'light'
  return appearance
}

/**
 * Paints the page in an appearance: `data-theme="dark"` on the root element for dark, nothing for light.
 *
 * @param appearance - The Settings > General choice ('system' | 'light' | 'dark')
 */
export function applyAppearance(appearance: AppearanceKey): void {
  if (typeof document === 'undefined') return
  const themeName = resolveTheme(appearance, systemDarkQuery()?.matches ?? false)
  if (themeName === 'dark') document.documentElement.dataset.theme = 'dark'
  else delete document.documentElement.dataset.theme
}

/**
 * Stores an appearance choice and paints it.
 *
 * @param appearance - The Settings > General choice ('system' | 'light' | 'dark')
 */
export function setAppearance(appearance: AppearanceKey): void {
  storeAppearance(appearance)
  applyAppearance(appearance)
}

/**
 * Paints the stored appearance and keeps it right: the page follows the operating system when it switches
 * between light and dark, and a choice made in another window of the app. Call once, before the first render.
 *
 * @returns A function that stops following (() => void)
 */
export function startAppearance(): () => void {
  const repaint = () => applyAppearance(readStoredAppearance())
  repaint()
  if (typeof window === 'undefined') return () => undefined
  const darkQuery = systemDarkQuery()
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === APPEARANCE_STORAGE_KEY) repaint()
  }
  darkQuery?.addEventListener('change', repaint)
  window.addEventListener('storage', handleStorage)
  return () => {
    darkQuery?.removeEventListener('change', repaint)
    window.removeEventListener('storage', handleStorage)
  }
}
