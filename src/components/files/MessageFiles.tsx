import type { ConversationMessage } from '@/api/conversationTypes'
import { joinClassNames } from '@/components/ui'
import { messages } from '@/i18n'
import { FileCardGrid } from './FileCardGrid'
import { readMessageFiles } from './fileDisplay'

interface MessageFilesProps {
  /** The agent of the conversation: the files live in its own files. */
  agentId: string
  message: ConversationMessage
  /** Which side of the chat the message sits on; the cards follow it. */
  side: 'start' | 'end'
}

/**
 * The files of one chat message, under its bubble: what the customer attached and what the
 * bot's reply hands back. Takes the width of the chat, so two or three cards fit side by side
 * instead of being squeezed into the bubble. Renders nothing for a message without files.
 *
 * @example
 * <MessageFiles agentId={conversation.agentId} message={message} side="start" />
 */
export function MessageFiles({ agentId, message, side }: MessageFilesProps) {
  const { attachments, files } = readMessageFiles(message)
  if (attachments.length === 0 && files.length === 0) return null
  const sideClassNames = joinClassNames('max-w-[30rem]', side === 'end' ? 'self-end' : 'self-start')
  return (
    <>
      <FileCardGrid agentId={agentId} cards={attachments} label={messages().files.attached} className={sideClassNames} />
      <FileCardGrid agentId={agentId} cards={files} label={messages().files.madeByTheAgent} className={sideClassNames} />
    </>
  )
}
