import { SUPPORTED_KNOWLEDGE_EXTENSIONS } from '@/api/knowledge'
import type { FileDropAccept } from '@/lib/fileDrop'
import { messages } from '@/i18n'

/** Knowledge drop zones take documents the backend can read and folders of them. */
export const knowledgeDropAccept: FileDropAccept = { extensions: SUPPORTED_KNOWLEDGE_EXTENSIONS, folders: true }

/** The accepted types, for the drop zone hint. */
export function knowledgeDropHint(): string {
  return messages().knowledge.dropHint
}
