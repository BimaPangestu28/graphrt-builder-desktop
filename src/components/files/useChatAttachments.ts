import { useCallback, useEffect, useRef, useState } from 'react'
import { attachDroppedChatFiles, discardChatAttachment, getAgentFileAbilities, pickChatAttachments } from '@/api/agentFiles'
import type { AttachOutcome, FileAbilities, FileCard } from '@/api/agentFileTypes'
import { toErrorMessage } from '@/lib/errors'
import { messages } from '@/i18n'

const noAbilities: FileAbilities = { readsFiles: false, seesPictures: false, makesFiles: false }
/** The owner can send documents and pictures, whatever the chatbot itself reads. */
const ownerAbilities: FileAbilities = { readsFiles: true, seesPictures: true, makesFiles: false }

export interface ChatAttachmentsOptions {
  /** The files are for the owner's own reply (Inbox), not for a customer's message (Try it). */
  asOwner?: boolean
}

/** The files waiting to be sent with the next message of one chat, and how to change them. */
export interface ChatAttachments {
  /** What the chat's agent can do with files; all false until loaded. */
  abilities: FileAbilities
  /** Whether anything can be attached. */
  takesFiles: boolean
  /** Files attached to the next message, in the order they were added. */
  pending: FileCard[]
  /** Lines to show under the composer: why files were refused, or why nothing can be attached. */
  notices: string[]
  /** A file dialog is open or files are being checked and stored. */
  isAttaching: boolean
  /** Opens the system file dialog and attaches what was chosen. */
  choose: () => void
  /** Attaches files dropped onto the window (`paths` as the drop reported them). */
  addDropped: (paths: string[]) => void
  /** Takes a file off the next message. */
  remove: (card: FileCard) => void
  /** Empties the list for sending and returns what was in it. */
  takeForSending: () => FileCard[]
  /** Puts files back after a message could not be sent. */
  putBack: (cards: FileCard[]) => void
}

function refusalNotices(outcomes: AttachOutcome[]): string[] {
  return outcomes.flatMap((outcome) => (outcome.problem ? [messages().files.notAttached(outcome.name, messages().files.problems[outcome.problem])] : []))
}

/**
 * The attachments of a chat composer: which files wait to be sent, the attach button's work and
 * the notices for files that were refused. Choosing and checking a file happens in the backend,
 * off the UI thread; this hook only keeps the list. The list starts empty again whenever the
 * conversation changes.
 *
 * @param agentId - The chat's agent (string)
 * @param conversationId - The chat, or null while it is being opened (string | null)
 * @param options.asOwner - The files are for the owner's own reply (boolean, default false)
 * @returns The pending files and the actions on them (ChatAttachments)
 *
 * @example
 * const attachments = useChatAttachments(agentId, conversationId)
 * <button onClick={attachments.choose}>Attach files</button>
 */
export function useChatAttachments(agentId: string, conversationId: string | null, { asOwner = false }: ChatAttachmentsOptions = {}): ChatAttachments {
  const [abilities, setAbilities] = useState<FileAbilities>(asOwner ? ownerAbilities : noAbilities)
  const [pending, setPending] = useState<FileCard[]>([])
  const [notices, setNotices] = useState<string[]>([])
  const [isAttaching, setIsAttaching] = useState(false)
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId

  useEffect(() => {
    if (asOwner) {
      setAbilities(ownerAbilities)
      return
    }
    let isCurrent = true
    setAbilities(noAbilities)
    getAgentFileAbilities(agentId)
      .then((loadedAbilities) => {
        if (isCurrent) setAbilities(loadedAbilities)
      })
      .catch((rawError: unknown) => console.error('Could not read what the agent does with files', rawError))
    return () => {
      isCurrent = false
    }
  }, [agentId, asOwner])

  const shownConversationIdRef = useRef(conversationId)

  useEffect(() => {
    // Another chat: its files and notices are not this one's. Not on mount: the state starts
    // empty, and a reset that ran after a quick first attach finished would drop that file.
    if (shownConversationIdRef.current !== conversationId) {
      shownConversationIdRef.current = conversationId
      setPending([])
      setNotices([])
      setIsAttaching(false)
    }
    // Leaving the chat (another chat, Reset, another screen) with files still waiting: they
    // will not be sent, so they are removed instead of staying behind.
    return () => {
      if (!conversationId) return
      for (const card of pendingRef.current) {
        discardChatAttachment(conversationId, card.reference).catch((rawError: unknown) => console.error('Could not remove an attached file', rawError))
      }
    }
  }, [conversationId])

  const takesFiles = abilities.readsFiles || abilities.seesPictures

  const attach = useCallback(
    (startAttaching: (forConversationId: string, alreadyAttached: number) => Promise<AttachOutcome[]>) => {
      const forConversationId = conversationIdRef.current
      if (!forConversationId) return
      if (!takesFiles) {
        setNotices([messages().files.doesNotTakeFilesYet])
        return
      }
      setIsAttaching(true)
      setNotices([])
      startAttaching(forConversationId, pendingRef.current.length)
        .then((outcomes) => {
          // The person started another chat meanwhile: these files belong to the old one.
          if (conversationIdRef.current !== forConversationId) return
          const attachedCards = outcomes.flatMap((outcome) => (outcome.card ? [outcome.card] : []))
          setPending((current) => [...current, ...attachedCards.filter((card) => !current.some((known) => known.reference === card.reference))])
          setNotices(refusalNotices(outcomes))
        })
        .catch((rawError: unknown) => {
          if (conversationIdRef.current === forConversationId) setNotices([messages().files.couldNotAttach(toErrorMessage(rawError))])
        })
        .finally(() => {
          if (conversationIdRef.current === forConversationId) setIsAttaching(false)
        })
    },
    [takesFiles],
  )

  const choose = useCallback(() => {
    attach((forConversationId, alreadyAttached) => pickChatAttachments(forConversationId, messages().files.attachDialogTitle, alreadyAttached, asOwner))
  }, [attach, asOwner])

  const addDropped = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return
      attach((forConversationId, alreadyAttached) => attachDroppedChatFiles(forConversationId, paths, alreadyAttached, asOwner))
    },
    [attach, asOwner],
  )

  const remove = useCallback((card: FileCard) => {
    setPending((current) => current.filter((known) => known.reference !== card.reference))
    const forConversationId = conversationIdRef.current
    if (!forConversationId) return
    // The file was already stored for this chat: remove it, since it will not be sent.
    discardChatAttachment(forConversationId, card.reference).catch((rawError: unknown) => console.error('Could not remove an attached file', rawError))
  }, [])

  const takeForSending = useCallback(() => {
    const taken = pendingRef.current
    // Emptied at once, not on the next render: a file that is being sent must not be removed
    // as "left behind" when the chat is left in the same moment.
    pendingRef.current = []
    setPending([])
    setNotices([])
    return taken
  }, [])

  const putBack = useCallback((cards: FileCard[]) => {
    setPending((current) => [...cards.filter((card) => !current.some((known) => known.reference === card.reference)), ...current])
  }, [])

  return { abilities, takesFiles, pending, notices, isAttaching, choose, addDropped, remove, takeForSending, putBack }
}
