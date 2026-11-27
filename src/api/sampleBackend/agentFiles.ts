import type { AttachOutcome, FileAbilities, FileCard, FileCardKind, FilePreview, SaveOutcome } from '../agentFileTypes'
import { maxAttachmentsPerMessage } from '../agentFileTypes'
import { respondWith } from './sampleResponse'

/**
 * Sample files for the browser preview and tests: there is no file system and no system dialog
 * there, so "choosing" a file attaches the next sample file, and saving only pretends.
 */

/** A 2x2 teal PNG, shown stretched as the preview of every sample picture. */
const samplePictureDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGPgq0kDIgYIBQAY7gPBAPJGqQAAAABJRU5ErkJggg=='

const sampleFilesToChoose: ReadonlyArray<Pick<FileCard, 'name' | 'sizeBytes'>> = [
  { name: 'daftar-pesanan-oktober.pdf', sizeBytes: 184_320 },
  { name: 'foto-lokasi-acara.jpg', sizeBytes: 912_400 },
  { name: 'harga-paket.xlsx', sizeBytes: 24_100 },
]

const kindsByExtension: Record<string, { kind: FileCardKind; mimeType: string }> = {
  pdf: { kind: 'pdf', mimeType: 'application/pdf' },
  jpg: { kind: 'picture', mimeType: 'image/jpeg' },
  jpeg: { kind: 'picture', mimeType: 'image/jpeg' },
  png: { kind: 'picture', mimeType: 'image/png' },
  docx: { kind: 'document', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { kind: 'spreadsheet', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  csv: { kind: 'spreadsheet', mimeType: 'text/csv' },
  txt: { kind: 'text', mimeType: 'text/plain' },
  md: { kind: 'text', mimeType: 'text/markdown' },
}

let nextFileNumber = 1
let nextChoice = 0
const storedCards = new Map<string, FileCard>()

function lastSegment(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Stores a sample file and returns its card, or null for a kind the sample agent does not take. */
function storeSampleFile(name: string, sizeBytes: number): FileCard | null {
  const extension = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  const known = kindsByExtension[extension]
  if (!known) return null
  const card: FileCard = {
    reference: `workspace:sample/${nextFileNumber}/${name}`,
    name,
    sizeBytes,
    mimeType: known.mimeType,
    kind: known.kind,
    preview: known.kind === 'picture' ? 'picture' : 'none',
  }
  nextFileNumber += 1
  storedCards.set(card.reference, card)
  return card
}

function attachNamed(names: Array<{ name: string; sizeBytes: number }>, alreadyAttached: number): AttachOutcome[] {
  let attached = alreadyAttached
  return names.map(({ name, sizeBytes }) => {
    if (attached >= maxAttachmentsPerMessage) return { name, card: null, problem: 'too_many' }
    const card = storeSampleFile(name, sizeBytes)
    if (!card) return { name, card: null, problem: 'unsupported_kind' }
    attached += 1
    return { name, card, problem: null }
  })
}

/**
 * The cards of the sample files `references` name, in order; unknown references are left out.
 *
 * @param references - `reference` of attached sample files (string[])
 * @returns Their cards (FileCard[])
 */
export function sampleCardsFor(references: string[]): FileCard[] {
  return references.flatMap((reference) => {
    const card = storedCards.get(reference)
    return card ? [card] : []
  })
}

/** A file the sample bot hands back when a customer sent files. */
export function sampleBotFile(): FileCard {
  return storeSampleFile('ringkasan-pesanan.pdf', 48_200) as FileCard
}

export const sampleAgentFilesBackend = {
  getAgentFileAbilities: (_agentId: string): Promise<FileAbilities> =>
    respondWith(() => ({ readsFiles: true, seesPictures: true, makesFiles: true })),
  pickChatAttachments: (_conversationId: string, alreadyAttached: number): Promise<AttachOutcome[]> =>
    respondWith(() => {
      const choice = sampleFilesToChoose[nextChoice % sampleFilesToChoose.length]
      nextChoice += 1
      return attachNamed([choice], alreadyAttached)
    }),
  attachDroppedChatFiles: (_conversationId: string, paths: string[], alreadyAttached: number): Promise<AttachOutcome[]> =>
    respondWith(() =>
      attachNamed(
        paths.map((path) => ({ name: lastSegment(path), sizeBytes: 120_000 })),
        alreadyAttached,
      ),
    ),
  discardChatAttachment: (_conversationId: string, reference: string): Promise<void> =>
    respondWith(() => {
      storedCards.delete(reference)
    }),
  listRunFiles: (_runId: string): Promise<FileCard[]> => respondWith(() => []),
  previewAgentFile: (_agentId: string, reference: string): Promise<FilePreview> =>
    respondWith(() =>
      storedCards.get(reference)?.preview === 'picture' ? { kind: 'picture', dataUrl: samplePictureDataUrl, width: 2, height: 2 } : { kind: 'none' },
    ),
  saveAgentFile: (_agentId: string, reference: string): Promise<SaveOutcome> =>
    respondWith(() => ({ saved: true, fileName: storedCards.get(reference)?.name ?? null })),
}

/** Forgets every sample file and starts choosing from the first sample again (tests). */
export function resetSampleAgentFiles(): void {
  storedCards.clear()
  nextFileNumber = 1
  nextChoice = 0
}
