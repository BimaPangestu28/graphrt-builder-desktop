import type { BuilderMessage } from '@/api/types'

/** The saved builder chat split into the reply to the first build and everything after it. */
export interface BuilderHistory {
  /** The model's explanation of the agent it first built, or null when none was saved. */
  openingExplanation: string | null
  /** Change requests, replies and restore notes after the build, oldest first. */
  laterMessages: BuilderMessage[]
}

/** The build's reply is the builder message that created a version with no version before it. */
function isBuildReply(message: BuilderMessage): boolean {
  return message.role === 'builder' && message.status === 'done' && message.versionBefore === null && message.versionAfter !== null
}

/**
 * Splits saved messages so the build's explanation can sit under the agent's description
 * and the rest follow in order.
 *
 * @param messages - Saved builder chat, oldest first (BuilderMessage[])
 * @returns The opening explanation and the later messages (BuilderHistory)
 *
 * @example
 * const { openingExplanation, laterMessages } = splitBuilderHistory(savedMessages)
 */
export function splitBuilderHistory(messages: BuilderMessage[]): BuilderHistory {
  const buildReply = messages.find(isBuildReply)
  return {
    openingExplanation: buildReply?.explanation?.trim() || null,
    laterMessages: messages.filter((message) => message !== buildReply),
  }
}
