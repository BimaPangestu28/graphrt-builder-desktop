import { messages } from '@/i18n'

/**
 * What a drop zone accepts and how dropped items are checked before they reach a backend
 * command (the backend validates again; this only gives the user an early, clear message).
 *
 * Dropped items arrive as absolute paths in the desktop app (Tauri drag and drop) and as
 * plain names in the browser preview (HTML drag and drop). Neither says reliably whether an
 * item is a folder, so a name with a short extension counts as a file and anything else as a
 * folder, unless the browser told us (`isFolder`).
 */

/** What a drop zone takes. */
export interface FileDropAccept {
  /** Lower-case extensions without the dot (`pdf`, `tar.gz`); empty or missing means any file. */
  extensions?: readonly string[]
  /** Files are accepted (default true). */
  files?: boolean
  /** Folders are accepted (default false). */
  folders?: boolean
}

/** One dropped or picked item. */
export interface DroppedItem {
  /** Absolute path in the desktop app; the plain name in the browser preview. */
  path: string
  kind: 'file' | 'folder'
}

/** A dropped item before it is checked; `isFolder` is set when the source knows. */
export interface RawDroppedItem {
  path: string
  isFolder?: boolean
}

/** Why the drop was refused, or null when everything was accepted. */
export interface DropCheck {
  accepted: DroppedItem[]
  /** A sentence for the user; null when nothing was refused. */
  rejection: string | null
}

const fileExtensionPattern = /\.[a-z0-9]{1,8}$/i

/**
 * The last segment of a path (`/Users/me/Menu.pdf` → `Menu.pdf`, `C:\\a\\b\\` → `b`).
 *
 * @example
 * lastPathSegment('/Users/me/Menu.pdf') // "Menu.pdf"
 */
export function lastPathSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** True when the name ends with one of `extensions` (multi-part ones like `tar.gz` included). */
export function hasAcceptedExtension(name: string, extensions: readonly string[]): boolean {
  const lowerName = name.toLowerCase()
  return extensions.some((extension) => lowerName.endsWith(`.${extension.toLowerCase()}`))
}

function guessKind(rawItem: RawDroppedItem, accept: FileDropAccept): DroppedItem['kind'] {
  if (rawItem.isFolder !== undefined) return rawItem.isFolder ? 'folder' : 'file'
  // Only one kind fits: let the backend tell a folder named like a file (or the reverse).
  if (accept.folders !== true) return 'file'
  if (accept.files === false) return 'folder'
  const name = lastPathSegment(rawItem.path)
  if (accept.extensions?.length && hasAcceptedExtension(name, accept.extensions)) return 'file'
  return fileExtensionPattern.test(name) && !name.startsWith('.') ? 'file' : 'folder'
}

function isAccepted(item: DroppedItem, accept: FileDropAccept): boolean {
  if (item.kind === 'folder') return accept.folders === true
  if (accept.files === false) return false
  const extensions = accept.extensions ?? []
  return extensions.length === 0 || hasAcceptedExtension(lastPathSegment(item.path), extensions)
}

/**
 * "a .tar.gz or .tgz file or a folder", for messages and hints.
 *
 * @example
 * describeAccepted({ extensions: ['tar.gz', 'tgz'], folders: true }) // "a folder or a .tar.gz or .tgz file"
 */
export function describeAccepted(accept: FileDropAccept): string {
  const t = messages().shell.fileDrop
  const extensions = accept.extensions ?? []
  const fileText =
    accept.files === false ? null : extensions.length === 0 ? t.aFile : t.aFileOfType(joinWithOr(extensions.map((extension) => `.${extension}`)))
  if (accept.folders && fileText) return t.aFolderOr(fileText)
  return accept.folders ? t.aFolder : (fileText ?? t.nothing)
}

function joinWithOr(words: string[]): string {
  const t = messages().shell.fileDrop
  if (words.length <= 2) return words.join(` ${t.orWord} `)
  return `${words.slice(0, 4).join(', ')}${words.length > 4 ? t.andSimilar : ''}`
}

/**
 * Checks dropped items against what a zone accepts.
 *
 * Items of the wrong type are left out and named in `rejection`; when the zone takes one item
 * and several were dropped, nothing is accepted (picking one at random would surprise).
 *
 * @param rawItems - What was dropped (RawDroppedItem[])
 * @param accept - What the zone takes (FileDropAccept)
 * @param multiple - The zone takes several items (boolean)
 * @returns The accepted items and a message for what was refused (DropCheck)
 *
 * @example
 * checkDroppedItems([{ path: '/a/notes.bin' }], { extensions: ['pdf'] }, true)
 * // { accepted: [], rejection: 'notes.bin is not a .pdf file' }
 */
export function checkDroppedItems(rawItems: RawDroppedItem[], accept: FileDropAccept, multiple: boolean): DropCheck {
  const nonEmptyItems = rawItems.filter((rawItem) => rawItem.path.trim() !== '')
  if (nonEmptyItems.length === 0) return { accepted: [], rejection: null }
  const t = messages().shell.fileDrop
  if (!multiple && nonEmptyItems.length > 1) return { accepted: [], rejection: t.oneItemAtATime(describeAccepted(accept)) }

  const items = nonEmptyItems.map((rawItem) => ({ path: rawItem.path, kind: guessKind(rawItem, accept) }))
  const accepted = items.filter((item) => isAccepted(item, accept))
  const refusedNames = items.filter((item) => !isAccepted(item, accept)).map((item) => lastPathSegment(item.path))
  if (refusedNames.length === 0) return { accepted, rejection: null }
  if (refusedNames.length === 1) return { accepted, rejection: t.isNot(refusedNames[0], describeAccepted(accept)) }
  const namesText = `${refusedNames.slice(0, 3).join(', ')}${refusedNames.length > 3 ? t.andMore(refusedNames.length - 3) : ''}`
  return { accepted, rejection: t.leftOut(namesText, describeAccepted(accept)) }
}
