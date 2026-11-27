import type { AppearanceKey } from './settings'

/**
 * Applies the appearance to the page: `data-theme="dark"` on the root element for Dark, nothing otherwise.
 *
 * Today only the UI blocks agents show (cards, tables, KPI tiles, charts, diagrams) have dark colours
 * (`[data-theme="dark"] .ui-block` in `index.css`); the rest of the app is light. So "System" stays light
 * until the whole app has a dark theme: a dark card in a light window is only right when someone chose Dark.
 *
 * @param appearance - The Settings > General choice ('system' | 'light' | 'dark')
 */
export function applyAppearance(appearance: AppearanceKey): void {
  if (typeof document === 'undefined') return
  if (appearance === 'dark') document.documentElement.dataset.theme = 'dark'
  else delete document.documentElement.dataset.theme
}
