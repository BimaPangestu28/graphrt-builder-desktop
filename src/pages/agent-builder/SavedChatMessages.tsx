import { stoppedReplyText, type BuilderMessage } from '@/api/types'
import { assistantBlockClassNames, describeFailedChange, UserChatBubble } from './ChatBubbles'

/** A saved builder reply: the model's explanation and the summary, or why the change failed. */
function SavedBuilderReply({ message }: { message: BuilderMessage }) {
  if (message.status === 'failed') return <p className="m-0 max-w-[92%] leading-[1.55] text-danger">{describeFailedChange(message.text)}</p>
  // A stopped change saved nothing (no version after it): "Stopped by you", quietly.
  if (message.versionAfter === null && message.text === stoppedReplyText) return <p className="m-0 max-w-[92%] leading-[1.55] text-muted">{message.text}</p>
  return (
    <div className={`${assistantBlockClassNames} gap-2.5`}>
      {message.explanation && <p className="m-0 leading-[1.55]">{message.explanation}</p>}
      <p className="m-0 leading-[1.55]">{message.text}</p>
    </div>
  )
}

/**
 * The builder chat saved on earlier visits, in the same style as the live exchanges after it.
 * Saved replies have no Undo; only the latest change of this visit can be undone.
 */
export function SavedChatMessages({ messages }: { messages: BuilderMessage[] }) {
  return messages.map((message) =>
    message.role === 'user' ? <UserChatBubble key={message.id}>{message.text}</UserChatBubble> : <SavedBuilderReply key={message.id} message={message} />,
  )
}
