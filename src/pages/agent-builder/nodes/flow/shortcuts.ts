import { detectDesktopPlatform } from '@/lib/platform'
import { messages } from '@/i18n'

/**
 * Canvas keyboard shortcuts (spec I1): which action a key press means. ⌘ on macOS,
 * Ctrl elsewhere. Pure, so the canvas and its tests share the same table.
 */

export type CanvasShortcutAction =
  | 'delete'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'select-all'
  | 'deselect'
  | 'nudge-left'
  | 'nudge-right'
  | 'nudge-up'
  | 'nudge-down'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit'
  | 'add-node'
  | 'show-shortcuts'
  | 'open-settings'
  | 'context-menu'

/** The parts of a keyboard event the table reads. */
export interface ShortcutKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** True on macOS, where ⌘ is the command key. */
export function isMacPlatform(): boolean {
  return detectDesktopPlatform() === 'macos'
}

const commandKeyActions: Record<string, CanvasShortcutAction> = { c: 'copy', v: 'paste', d: 'duplicate', a: 'select-all', y: 'redo', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out' }
const arrowActions: Record<string, CanvasShortcutAction> = { ArrowLeft: 'nudge-left', ArrowRight: 'nudge-right', ArrowUp: 'nudge-up', ArrowDown: 'nudge-down' }
const plainKeyActions: Record<string, CanvasShortcutAction> = {
  Delete: 'delete',
  Backspace: 'delete',
  Escape: 'deselect',
  '+': 'zoom-in',
  '=': 'zoom-in',
  '-': 'zoom-out',
  f: 'fit',
  F: 'fit',
  '!': 'fit',
  a: 'add-node',
  A: 'add-node',
  '?': 'show-shortcuts',
  Enter: 'open-settings',
  ContextMenu: 'context-menu',
}

/**
 * The canvas action for a key press, or null when the canvas should ignore it.
 *
 * @param event - The key press (ShortcutKeyEvent)
 * @param isMac - Use ⌘ (true) or Ctrl (false) as the command key
 * @returns The action, or null (CanvasShortcutAction | null)
 *
 * @example
 * resolveShortcut({ key: 'z', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false }, true) // 'redo'
 */
export function resolveShortcut(event: ShortcutKeyEvent, isMac: boolean): CanvasShortcutAction | null {
  const commandKey = isMac ? event.metaKey : event.ctrlKey
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (commandKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y' && isMac) return null
    return commandKeyActions[key] ?? null
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (arrowActions[event.key]) return arrowActions[event.key]
  if (event.key === 'F10' && event.shiftKey) return 'context-menu'
  // Shift 1 fits the whole agent (spec); on most layouts it types "!".
  if (event.shiftKey && (event.key === '1' || event.key === '!')) return 'fit'
  return plainKeyActions[event.key] ?? null
}

/** Canvas units an arrow key moves the selection (Shift: a bigger step). */
export function nudgeDistance(event: Pick<ShortcutKeyEvent, 'shiftKey'>): number {
  return event.shiftKey ? 50 : 10
}

/** True when the key press is typing in a field, which the canvas must leave alone. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** One row of the shortcuts panel. */
export interface ShortcutHelpRow {
  label: string
  keys: string
}

/** The shortcuts panel ("?") rows, with the platform's command key. */
export function listShortcutHelp(isMac: boolean): ShortcutHelpRow[] {
  const command = isMac ? '⌘' : 'Ctrl+'
  return [
    { label: messages().nodes.pan, keys: messages().nodes.spaceDragOrScroll },
    { label: messages().nodes.zoom, keys: messages().nodes.commandScroll(command) },
    { label: messages().nodes.fitTheWholeAgent, keys: messages().nodes.fOrShift1 },
    { label: messages().nodes.addNode, keys: 'A' },
    { label: messages().nodes.selectSeveral, keys: messages().nodes.dragOnEmptyCanvasShiftClick },
    { label: messages().nodes.selectAll, keys: `${command}A` },
    { label: messages().nodes.copyPaste, keys: `${command}C / ${command}V` },
    { label: messages().nodes.duplicate, keys: `${command}D` },
    { label: messages().nodes.delete, keys: messages().nodes.deleteOr },
    { label: messages().nodes.undoRedo, keys: isMac ? '⌘Z / ⇧⌘Z' : messages().nodes.ctrlZCtrlShiftZ },
    { label: messages().nodes.nextNode, keys: messages().nodes.tab },
    { label: messages().nodes.openItsSettings, keys: messages().nodes.enter },
    { label: messages().nodes.nodeMenu, keys: messages().nodes.shiftF10 },
    { label: messages().nodes.moveANode, keys: messages().nodes.arrowKeysShiftFurther },
    { label: messages().nodes.closeDeselect, keys: messages().nodes.esc },
  ]
}
