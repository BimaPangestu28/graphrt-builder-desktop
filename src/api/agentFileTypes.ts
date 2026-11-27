/**
 * Files of an agent: what a person attaches in a chat and the files an agent hands back.
 * Mirrors `src-tauri/src/agent_files` (camelCase JSON); keep both in sync.
 */

/** The kind of a file, in the words a person uses. It picks the icon and the label. */
export type FileCardKind = 'picture' | 'pdf' | 'document' | 'spreadsheet' | 'slides' | 'text' | 'web_page' | 'other'

/** `picture`: the card shows a small copy. `none`: the file is offered as a download only. */
export type FilePreviewKind = 'picture' | 'none'

/** One file of an agent, as a card shows it. */
export interface FileCard {
  /** `workspace:<path>`: names the file in its agent's files, for the preview and the download. */
  reference: string
  name: string
  sizeBytes: number
  /** Detected from the content, e.g. `application/pdf`. */
  mimeType: string
  kind: FileCardKind
  preview: FilePreviewKind
}

/** What a card may show of a file's content. */
export type FilePreview = { kind: 'picture'; dataUrl: string; width: number; height: number } | { kind: 'none' }

/** What a person can do with an agent's files. */
export interface FileAbilities {
  /** Documents and text files can be attached: the agent reads them. */
  readsFiles: boolean
  /** Pictures can be attached: the agent looks at them. */
  seesPictures: boolean
  /** The agent can hand files back. */
  makesFiles: boolean
}

/** Why a chosen file was not attached. */
export type AttachProblem =
  | 'not_chosen'
  | 'not_a_file'
  | 'unreadable'
  | 'empty'
  | 'too_large'
  | 'unsupported_kind'
  | 'unsupported_picture'
  | 'picture_too_large'
  | 'files_not_read'
  | 'pictures_not_seen'
  | 'too_many'
  | 'no_room_left'
  | 'not_stored'

/** What happened to one chosen file: it has a card or a problem. */
export interface AttachOutcome {
  /** The file's own name, without its folder. */
  name: string
  card: FileCard | null
  problem: AttachProblem | null
}

/** What saving a file did; `saved` is false when the person closed the dialog. */
export interface SaveOutcome {
  saved: boolean
  fileName: string | null
}

/** Most files one message takes (the backend refuses more). */
export const maxAttachmentsPerMessage = 8

const fileCardKinds: readonly string[] = ['picture', 'pdf', 'document', 'spreadsheet', 'slides', 'text', 'web_page', 'other'] satisfies FileCardKind[]

function isFileCard(value: unknown): value is FileCard {
  if (typeof value !== 'object' || value === null) return false
  const card = value as Record<string, unknown>
  return (
    typeof card.reference === 'string' &&
    typeof card.name === 'string' &&
    typeof card.sizeBytes === 'number' &&
    typeof card.mimeType === 'string' &&
    typeof card.kind === 'string' &&
    fileCardKinds.includes(card.kind) &&
    (card.preview === 'picture' || card.preview === 'none')
  )
}

/**
 * Reads file cards out of untyped JSON (a message's metadata). Anything that is not a card is left out.
 *
 * @param value - The stored value (unknown)
 * @returns The cards in order (FileCard[])
 *
 * @example
 * readFileCards(message.metadata.files)
 */
export function readFileCards(value: unknown): FileCard[] {
  return Array.isArray(value) ? value.filter(isFileCard) : []
}
