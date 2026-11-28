import { useState } from 'react'
import { decideMemoryNote, deleteMemoryNote, forgetMemoryPerson, getAgentAbilities, getAgentMemory, getMemoryGraph, listMemoryNotes } from '@/api/abilities'
import type { MemoryNote, MemoryPerson } from '@/api/abilitiesTypes'
import { Button, Card, LinkButton } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useT } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'
import { agentPath } from '@/routes'
import { describeFact, describeNoteMeta, describePerson, describePersonDetails, sortNotes } from './memoryDisplay'

interface NoteListProps {
  agentId: string
  /** `null`: the agent's own notes. */
  user: string | null
  notes: MemoryNote[]
  onChanged: () => void
}

/** The notes of one person (or of the agent), waiting ones first, each with its actions. */
function NoteList({ agentId, user, notes, onChanged }: NoteListProps) {
  const t = useT().abilities.memoryTab
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(noteId: string, action: () => Promise<unknown>) {
    setBusyNoteId(noteId)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (actionError) {
      setError(t.couldNotChange(describeError(actionError)))
    } finally {
      setBusyNoteId(null)
    }
  }

  if (notes.length === 0) return <p className="m-0 text-[13px] text-muted">{t.noNotes}</p>
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ul className="m-0 grid min-w-0 list-none grid-cols-1 gap-2 p-0 lg:grid-cols-2">
        {sortNotes(notes).map((note) => {
          const isWaiting = note.status === 'pending'
          const isBusy = busyNoteId === note.id
          return (
            <li key={note.id} className={`flex min-w-0 flex-col gap-1.5 rounded-[10px] border px-3 py-2.5 ${isWaiting ? 'border-amber-line-2 bg-amber-tint' : 'border-line bg-surface'}`}>
              <p className="m-0 line-clamp-3 text-[14px] leading-normal font-medium text-ink" title={note.text}>
                {note.text}
              </p>
              <span className="line-clamp-2 text-[12px] leading-[17px] text-muted">{describeNoteMeta(note)}</span>
              {isWaiting && <span className="text-[12px] font-semibold text-amber-deep">{`${t.waiting} · ${t.waitingHint}`}</span>}
              <div className="flex flex-wrap gap-2">
                {isWaiting && (
                  <>
                    <Button variant="approve" size="sm" disabled={isBusy} onClick={() => void act(note.id, () => decideMemoryNote(agentId, user, note.id, true))}>
                      {t.approve}
                    </Button>
                    <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => void act(note.id, () => decideMemoryNote(agentId, user, note.id, false))}>
                      {t.reject}
                    </Button>
                  </>
                )}
                {!isWaiting && (
                  <Button variant="ghost" size="sm" disabled={isBusy} aria-label={`${t.remove}: ${note.text}`} onClick={() => void act(note.id, () => deleteMemoryNote(agentId, user, note.id))}>
                    {t.remove}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** The connections the memory graph made for one person (advanced). */
function PersonGraph({ agentId, user }: { agentId: string; user: string }) {
  const t = useT().abilities.memoryTab
  const graph = useAsyncData(() => getMemoryGraph(agentId, user), [agentId, user])
  if (graph.error) return <p className="m-0 text-[13px] text-danger">{t.couldNotChange(describeError(graph.error))}</p>
  if (!graph.data) return <p className="m-0 text-[13px] text-muted">{t.loading}</p>
  if (graph.data.unreadable) return <p className="m-0 text-[13px] text-amber-deep">{t.graphUnreadable}</p>
  if (graph.data.facts.length === 0) return <p className="m-0 text-[13px] text-muted">{t.graphEmpty}</p>
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {graph.data.facts.map((fact) => (
        <li key={fact.id} className={`min-w-0 truncate text-[13px] ${fact.isClosed ? 'text-muted line-through' : 'text-ink'}`} title={describeFact(fact)}>
          {describeFact(fact)}
        </li>
      ))}
    </ul>
  )
}

interface PersonCardProps {
  agentId: string
  person: MemoryPerson
  keepsGraph: boolean
  /** After a change; `notice` says what forgetting removed. */
  onChanged: (notice?: string) => void
}

function PersonCard({ agentId, person, keepsGraph, onChanged }: PersonCardProps) {
  const t = useT().abilities.memoryTab
  const [isOpen, setIsOpen] = useState(false)
  const [isGraphOpen, setIsGraphOpen] = useState(false)
  const [isAsking, setIsAsking] = useState(false)
  const [isForgetting, setIsForgetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notes = useAsyncData(() => (isOpen ? listMemoryNotes(agentId, person.user) : Promise.resolve(null)), [agentId, person.user, isOpen, person.noteCount, person.waitingCount])
  const who = describePerson(person)

  async function forget() {
    setIsForgetting(true)
    setError(null)
    try {
      const forgotten = await forgetMemoryPerson(agentId, person.user)
      setIsAsking(false)
      onChanged(t.forgotten(forgotten.notes, forgotten.lessons))
    } catch (forgetError) {
      setError(t.couldNotChange(describeError(forgetError)))
    } finally {
      setIsForgetting(false)
    }
  }

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 basis-[220px] flex-col gap-0.5">
          <span title={who} className="truncate text-[15px] font-semibold text-ink">
            {who}
          </span>
          <span title={describePersonDetails(person)} className="truncate text-[12px] text-muted">
            {describePersonDetails(person)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" aria-expanded={isOpen} onClick={() => setIsOpen((current) => !current)}>
            {isOpen ? t.hideNotes : t.showNotes}
          </Button>
          {keepsGraph && (
            <Button variant="ghost" size="sm" aria-expanded={isGraphOpen} onClick={() => setIsGraphOpen((current) => !current)}>
              {isGraphOpen ? t.hideGraph : t.showGraph}
            </Button>
          )}
          {!isAsking && (
            <Button variant="danger" size="sm" onClick={() => setIsAsking(true)} aria-label={`${t.forget}: ${who}`}>
              {t.forget}
            </Button>
          )}
        </div>
      </div>
      {isAsking && (
        <div role="group" aria-label={t.forgetConfirm(who)} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-danger-line bg-danger-tint px-3 py-2">
          <span className="min-w-0 flex-1 basis-[260px] text-[13px] text-ink">{t.forgetConfirm(who)}</span>
          <Button variant="danger" size="sm" disabled={isForgetting} onClick={() => void forget()}>
            {t.forgetYes}
          </Button>
          <Button variant="ghost" size="sm" disabled={isForgetting} onClick={() => setIsAsking(false)}>
            {t.forgetNo}
          </Button>
        </div>
      )}
      {isGraphOpen && <PersonGraph agentId={agentId} user={person.user} />}
      {isOpen && notes.error && <p className="m-0 text-[13px] text-danger">{t.couldNotLoad(describeError(notes.error))}</p>}
      {isOpen && notes.data && <NoteList agentId={agentId} user={person.user} notes={notes.data} onChanged={() => onChanged()} />}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
    </Card>
  )
}

/**
 * The Remembered tab of "What this agent learned": the people the agent keeps notes about,
 * each with their notes (approve the ones that wait, remove any) and "Forget this person"
 * (every note, connection and lesson about them), then the agent's own notes.
 */
export function MemoryPanel({ agentId }: { agentId: string }) {
  const t = useT().abilities.memoryTab
  const memory = useAsyncData(() => getAgentMemory(agentId), [agentId])
  const abilities = useAsyncData(() => getAgentAbilities(agentId), [agentId])
  const [notice, setNotice] = useState<string | null>(null)
  const reload = (nextNotice?: string) => {
    setNotice(nextNotice ?? null)
    void memory.reload()
  }
  const isEnabled = abilities.data?.memory.enabled ?? true
  const keepsGraph = abilities.data?.memory.graph ?? false

  if (memory.error) return <p role="alert" className="m-0 text-[13px] text-danger">{t.couldNotLoad(describeError(memory.error))}</p>
  if (!memory.data) return <p className="m-0 text-muted">{t.loading}</p>
  const { people, agentNotes } = memory.data
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="m-0 text-[16px] font-semibold">{t.title}</h2>
        <p className="m-0 text-[13px] leading-normal text-body">{t.subtitle}</p>
      </div>
      {!isEnabled && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-line-2 bg-amber-tint p-3.5">
          <span className="min-w-0 flex-1 basis-[280px] text-[13px] text-amber-deep">{t.off}</span>
          <LinkButton to={agentPath('builder', agentId)} variant="secondary" className="!text-ink">
            {t.openAbilities}
          </LinkButton>
        </Card>
      )}
      {notice && (
        <p role="status" className="m-0 text-[13px] text-ok-strong">
          {notice}
        </p>
      )}
      {people.length === 0 && agentNotes.length === 0 ? (
        <p className="m-0 rounded-[14px] border border-dashed border-line-strong px-4 py-8 text-center text-muted">{t.empty}</p>
      ) : (
        <ul aria-label={t.title} className="m-0 flex list-none flex-col gap-3 p-0">
          {people.map((person) => (
            <li key={person.user} className="min-w-0">
              <PersonCard
                agentId={agentId}
                person={person}
                keepsGraph={keepsGraph}
                onChanged={reload}
              />
            </li>
          ))}
        </ul>
      )}
      {agentNotes.length > 0 && (
        <Card className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-ink">{t.agentNotes}</span>
            <span className="text-[12px] text-muted">{t.agentNotesHint}</span>
          </div>
          <NoteList agentId={agentId} user={null} notes={agentNotes} onChanged={() => reload()} />
        </Card>
      )}
    </div>
  )
}
