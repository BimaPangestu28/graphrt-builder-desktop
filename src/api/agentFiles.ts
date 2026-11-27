import { callBackend, isDesktopApp } from './client'
import type { AttachOutcome, FileAbilities, FileCard, FilePreview, SaveOutcome } from './agentFileTypes'
import { sampleAgentFilesBackend } from './sampleBackend/agentFiles'

/**
 * Attaching files to a chat, and showing and saving the files an agent made.
 *
 * The desktop backend opens the system dialogs itself: the screens never send it a path on this
 * computer, except the paths of a drop, which it takes only when the window reported that drop.
 * A file is named by its `reference`, which only resolves inside its agent's own files.
 * Sample data outside the desktop app.
 */

/** Whether an agent reads files, looks at pictures and hands files back. */
export function getAgentFileAbilities(agentId: string): Promise<FileAbilities> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleAgentFilesBackend.getAgentFileAbilities(agentId)
  return callBackend('get_agent_file_abilities', { agentId })
}

/**
 * Opens the system file dialog and attaches what the person chose to the conversation.
 *
 * @param conversationId - The chat the files are for (string)
 * @param title - The dialog's title (string)
 * @param alreadyAttached - How many files the message holds so far (number)
 * @param asOwner - The files are for the owner's own reply, not a customer's message (boolean, default false)
 * @returns One outcome per chosen file, empty when the dialog was closed (AttachOutcome[])
 */
export function pickChatAttachments(conversationId: string, title: string, alreadyAttached: number, asOwner = false): Promise<AttachOutcome[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleAgentFilesBackend.pickChatAttachments(conversationId, alreadyAttached)
  return callBackend('pick_chat_attachments', { conversationId, title, alreadyAttached, asOwner })
}

/** Attaches files dropped onto the window (`paths` as the drop reported them); `asOwner` as in {@link pickChatAttachments}. */
export function attachDroppedChatFiles(conversationId: string, paths: string[], alreadyAttached: number, asOwner = false): Promise<AttachOutcome[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleAgentFilesBackend.attachDroppedChatFiles(conversationId, paths, alreadyAttached)
  return callBackend('attach_dropped_chat_files', { conversationId, paths, alreadyAttached, asOwner })
}

/** Removes an attached file the person took off the message before sending it. */
export function discardChatAttachment(conversationId: string, reference: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleAgentFilesBackend.discardChatAttachment(conversationId, reference)
  return callBackend('discard_chat_attachment', { conversationId, reference })
}

/** The files a run made, for the Run result screen. */
export function listRunFiles(runId: string): Promise<FileCard[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleAgentFilesBackend.listRunFiles(runId)
  return callBackend('list_run_files', { runId })
}

/** What a card may show of a file: a small copy of a picture, or nothing. */
export function previewAgentFile(agentId: string, reference: string): Promise<FilePreview> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleAgentFilesBackend.previewAgentFile(agentId, reference)
  return callBackend('preview_agent_file', { agentId, reference })
}

/**
 * Opens the system save dialog and writes a copy of the file where the person chose. The one
 * way a file of an agent leaves the app: chat replies, run results and UI blocks all pass the
 * file's `reference`.
 *
 * @param agentId - The agent the file belongs to (string)
 * @param reference - The file's `reference` (string)
 * @param title - The dialog's title (string)
 * @returns Whether it was saved, and under which name (SaveOutcome)
 * @throws BackendError - `not_found` when the reference names no file of that agent
 */
export function saveAgentFile(agentId: string, reference: string, title: string): Promise<SaveOutcome> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleAgentFilesBackend.saveAgentFile(agentId, reference)
  return callBackend('save_agent_file', { agentId, reference, title })
}
