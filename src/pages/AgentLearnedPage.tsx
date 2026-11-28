import { useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { isBackendErrorWithCode } from '@/api/client'
import { addLearningNote, forgetLearningPerson, getAgentLearning, setAgentUsesLearning, setAutoLearn, suggestNotesFromRuns } from '@/api/learning'
import type { AgentLearning, RunSuggestions } from '@/api/learningTypes'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Button, Card, Icon, LinkButton, PillTabBadge, Spinner, pillTabClassNames } from '@/components/ui'
import { useAgent } from '@/hooks/useAgent'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { useT } from '@/i18n'
import { agentPath, connectionsTabPath, sampleAgentId, skillFromNotesPath } from '@/routes'
import { LessonCard } from './learning/LessonCard'
import { MemoryPanel } from './learning/MemoryPanel'
import { describeHistoryEntry, describeHistoryTime, lessonsOfTab, peopleRemembered, type LessonTab } from './learning/lessonDisplay'

/** The lesson tabs, then what the agent remembers about people (long term memory). */
type PageTab = LessonTab | 'memory'
const tabs: readonly PageTab[] = ['waiting', 'inUse', 'notUsed', 'history', 'memory']
const tabParam = 'tab'
const maxNoteChars = 500

function readTab(value: string | null): PageTab {
  return tabs.find((tab) => tab === value) ?? 'waiting'
}

interface SwitchRowProps {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  children?: ReactNode
}

function SwitchRow({ label, hint, checked, disabled, onChange, children }: SwitchRowProps) {
  return (
    <Card className="flex flex-col gap-1.5 p-4">
      <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-ink">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="size-4 shrink-0 accent-ink" />
        {label}
      </label>
      <p className="m-0 pl-[26px] text-[12px] leading-normal text-muted">{hint}</p>
      {children}
    </Card>
  )
}

/** The two switches: whether the agent reads its notes, and whether it may learn by itself (off by default). */
function LearningSwitches({ learning, onChanged }: { learning: AgentLearning; onChanged: () => void }) {
  const t = useT().learning.switches
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canUse = learning.usage.capableSteps > 0
  const isUsing = canUse && learning.usage.readingSteps === learning.usage.capableSteps

  async function save(change: () => Promise<unknown>) {
    setIsSaving(true)
    setError(null)
    try {
      await change()
      onChanged()
    } catch (saveError) {
      setError(isBackendErrorWithCode(saveError, 'builder_busy') ? t.builderBusy : t.couldNotSave(describeError(saveError)))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SwitchRow
          label={t.useLabel}
          hint={!canUse ? t.cannotUse : isUsing ? t.useHint : t.useOffHint}
          checked={isUsing}
          disabled={isSaving || !canUse}
          onChange={(enabled) => void save(() => setAgentUsesLearning(learning.agentId, enabled))}
        />
        <SwitchRow label={t.autoLabel} hint={t.autoHint} checked={learning.autoLearn} disabled={isSaving} onChange={(enabled) => void save(() => setAutoLearn(learning.agentId, enabled))} />
      </div>
      {isSaving && <span className="text-[12px] text-muted">{t.saving}</span>}
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
    </div>
  )
}

/** "Add a note yourself": the owner's own words, used at once. */
function AddNoteForm({ agentId, onAdded }: { agentId: string; onAdded: () => void }) {
  const t = useT().learning
  const [text, setText] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setIsAdding(true)
    setError(null)
    try {
      await addLearningNote(agentId, text)
      setText('')
      onAdded()
    } catch (addError) {
      setError(t.actions.couldNot(describeError(addError)))
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <Card className="flex flex-col gap-2 p-4">
      <span className="text-[14px] font-semibold text-ink">{t.addNote.heading}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label={t.addNote.label}
          value={text}
          maxLength={maxNoteChars}
          placeholder={t.addNote.placeholder}
          disabled={isAdding}
          onChange={(event) => setText(event.target.value)}
          className="box-border h-10 min-w-0 flex-1 basis-[320px] rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-ink"
        />
        <Button disabled={isAdding || !text.trim()} onClick={() => void add()}>
          <Icon name="plus" size={16} />
          {t.addNote.add}
        </Button>
      </div>
      <span className="text-[12px] text-muted">{t.addNote.hint}</span>
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
    </Card>
  )
}

/**
 * "Look at recent runs": the owner asks their AI model to read the agent's latest runs and
 * suggest notes. Whatever it suggests lands in "Waiting for you"; nothing is used before the
 * owner approves it.
 */
function SuggestFromRunsCard({ agentId, onSuggested }: { agentId: string; onSuggested: () => void }) {
  const t = useT().learning.suggest
  const [isLooking, setIsLooking] = useState(false)
  const [outcome, setOutcome] = useState<RunSuggestions | null>(null)
  const [error, setError] = useState<{ message: string; needsModel: boolean } | null>(null)

  async function look() {
    setIsLooking(true)
    setError(null)
    setOutcome(null)
    try {
      const suggestions = await suggestNotesFromRuns(agentId)
      setOutcome(suggestions)
      if (suggestions.proposed.length > 0) onSuggested()
    } catch (lookError) {
      const needsModel = isBackendErrorWithCode(lookError, 'missing_credentials')
      const keyUnreadable = isBackendErrorWithCode(lookError, 'credentials')
      setError({ message: needsModel ? t.noModel : keyUnreadable ? t.keyUnreadable : t.couldNot(describeError(lookError)), needsModel })
    } finally {
      setIsLooking(false)
    }
  }

  const result = outcome && (outcome.runsRead === 0 ? t.nothingNew : outcome.proposed.length === 0 ? t.nothingFound(outcome.runsRead) : t.found(outcome.proposed.length))
  return (
    <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4">
      <div className="flex min-w-0 flex-1 basis-[320px] flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-ink">{t.heading}</span>
        <span className="text-[12px] leading-normal text-muted">{t.hint}</span>
      </div>
      <Button variant="secondary" disabled={isLooking} onClick={() => void look()}>
        {isLooking ? <Spinner /> : <Icon name="lightbulb" size={16} />}
        {isLooking ? t.looking : t.look}
      </Button>
      {result && (
        <span role="status" className="basis-full text-[13px] text-body">
          {result}
        </span>
      )}
      {error && (
        <div role="alert" className="flex basis-full flex-wrap items-center gap-3 text-[13px] text-danger">
          <span>{error.message}</span>
          {error.needsModel && (
            <LinkButton to={connectionsTabPath('models')} variant="secondary" size="sm" className="!text-ink">
              {t.connectModel}
            </LinkButton>
          )}
        </div>
      )}
    </Card>
  )
}

/** "Turn these notes into a skill": shown once enough notes in use describe how to do the work. */
function SkillFromNotesCard({ agentId }: { agentId: string }) {
  const t = useT().learning.toSkill
  return (
    <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4">
      <div className="flex min-w-0 flex-1 basis-[320px] flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-ink">{t.heading}</span>
        <span className="text-[12px] leading-normal text-muted">{t.hint}</span>
      </div>
      <LinkButton to={skillFromNotesPath(agentId)} variant="secondary" className="!text-ink">
        {t.write}
      </LinkButton>
    </Card>
  )
}

/** "People it remembers": forget a person and every note about them. */
function PeopleSection({ learning, onChanged }: { learning: AgentLearning; onChanged: () => void }) {
  const t = useT().learning
  const people = peopleRemembered(learning.lessons)
  const [asking, setAsking] = useState<string | null>(null)
  const [isForgetting, setIsForgetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (people.length === 0) return null

  async function forget(person: string) {
    setIsForgetting(true)
    setError(null)
    try {
      await forgetLearningPerson(learning.agentId, person)
      setAsking(null)
      onChanged()
    } catch (forgetError) {
      setError(t.actions.couldNot(describeError(forgetError)))
    } finally {
      setIsForgetting(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[16px] font-semibold">{t.people.heading}</h2>
        <span className="text-[12px] text-muted">{t.people.hint}</span>
      </div>
      <ul aria-label={t.people.heading} className="m-0 grid list-none grid-cols-1 gap-2 p-0 lg:grid-cols-2">
        {people.map(({ person, noteCount }) => (
          <li key={person} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-medium text-ink">{person}</span>
              <span className="text-[12px] text-muted">{t.people.noteCount(noteCount)}</span>
            </span>
            {asking === person ? (
              <span role="group" aria-label={t.people.confirm(person)} className="flex flex-wrap items-center gap-2">
                <span className="basis-full text-[13px] text-ink">{t.people.confirm(person)}</span>
                <Button variant="danger" size="sm" disabled={isForgetting} onClick={() => void forget(person)}>
                  {t.people.confirmForget}
                </Button>
                <Button variant="ghost" size="sm" disabled={isForgetting} onClick={() => setAsking(null)}>
                  {t.actions.cancel}
                </Button>
              </span>
            ) : (
              <Button variant="secondary" size="sm" aria-label={t.people.forgetPerson(person)} onClick={() => setAsking(person)}>
                {t.people.forget}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
    </Card>
  )
}

function HistoryList({ learning }: { learning: AgentLearning }) {
  const t = useT().learning
  if (learning.history.length === 0) return <EmptyTab message={t.empty.history} />
  return (
    <ol aria-label={t.history.listLabel} className="m-0 flex list-none flex-col gap-0 rounded-[14px] border border-line bg-surface p-0">
      {learning.history.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-chip px-4 py-2.5 last:border-b-0">
          <span className="w-[150px] shrink-0 text-[12px] text-muted tabular-nums">{describeHistoryTime(entry)}</span>
          <span className="text-[14px] font-medium text-ink">{describeHistoryEntry(entry)}</span>
          {entry.lessonText && (
            <span className="min-w-0 flex-1 basis-[240px] truncate text-[13px] text-body" title={entry.lessonText}>
              “{entry.lessonText}”
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

function EmptyTab({ message }: { message: string }) {
  return <p className="m-0 rounded-[14px] border border-dashed border-line-strong px-4 py-8 text-center text-muted">{message}</p>
}

/**
 * Screen 70 · What this agent learned (`/agents/:agentId/learned`). The notes the agent
 * picked up: the ones waiting for the owner first (high risk on top), the ones in use, the
 * ones not used and the history. A note is used only after the owner approves it here, and
 * only once "Use what it learned" is on. "Learn automatically" is off unless turned on.
 */
export function AgentLearnedPage() {
  const t = useT().learning
  const memoryTabLabel = useT().abilities.memoryTab.tab
  const { agentId = sampleAgentId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = readTab(searchParams.get(tabParam))
  const { data: agent } = useAgent(agentId)
  const loaded = useAsyncData(() => getAgentLearning(agentId), [agentId])
  const learning = loaded.data
  const reload = () => void loaded.reload()
  const counts: Record<PageTab, number | null> = {
    waiting: learning ? lessonsOfTab(learning.lessons, 'waiting').length : null,
    inUse: learning ? lessonsOfTab(learning.lessons, 'inUse').length : null,
    notUsed: learning ? lessonsOfTab(learning.lessons, 'notUsed').length : null,
    history: null,
    memory: null,
  }
  const tabLabel = (candidate: PageTab) => (candidate === 'memory' ? memoryTabLabel : t.tabs[candidate])
  const isUsing = learning ? learning.usage.capableSteps > 0 && learning.usage.readingSteps === learning.usage.capableSteps : false

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: agentId }}>
      <PageFrame>
        <div className="flex flex-col gap-3">
          <Link to={agentPath('builder', agentId)} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium no-underline !text-ink-2 hover:underline">
            <Icon name="arrowLeft" size={14} />
            {t.backToAgent}
          </Link>
          <PageTitleBlock title={t.title(agent?.name ?? '…')} subtitle={t.subtitle} />
        </div>
        {loaded.error && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {t.couldNotLoad(describeError(loaded.error))}
          </p>
        )}
        {!loaded.error && !learning && <p className="m-0 text-muted">{t.loading}</p>}
        {learning && (
          <>
            <LearningSwitches learning={learning} onChanged={reload} />
            <div role="tablist" aria-label={t.tabsLabel} className="flex flex-wrap gap-2">
              {tabs.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  aria-selected={tab === candidate}
                  onClick={() => setSearchParams(candidate === 'waiting' ? {} : { [tabParam]: candidate }, { replace: true })}
                  className={pillTabClassNames(tab === candidate)}
                >
                  {tabLabel(candidate)}
                  {/* Keeps the accessible name "In use 3", not "In use3". */}
                  {counts[candidate] !== null && ' '}
                  {counts[candidate] !== null && (
                    <PillTabBadge isActive={tab === candidate} isWarning={candidate === 'waiting' && (counts.waiting ?? 0) > 0}>
                      {counts[candidate]}
                    </PillTabBadge>
                  )}
                </button>
              ))}
            </div>
            {tab === 'memory' ? (
              <MemoryPanel agentId={agentId} />
            ) : tab === 'history' ? (
              <HistoryList learning={learning} />
            ) : (
              <>
                {tab === 'inUse' && !isUsing && (counts.inUse ?? 0) > 0 && <p className="m-0 rounded-[10px] border border-amber-line-2 bg-amber-tint px-3 py-2 text-[13px] text-amber-deep">{t.notUsedYet}</p>}
                {lessonsOfTab(learning.lessons, tab).length === 0 ? (
                  <EmptyTab message={t.empty[tab]} />
                ) : (
                  <ul aria-label={t.listLabel[tab]} className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
                    {lessonsOfTab(learning.lessons, tab).map((lesson) => (
                      <li key={`${lesson.id}-${lesson.updatedAt}`} className="min-w-0">
                        <LessonCard agentId={agentId} lesson={lesson} onChanged={reload} />
                      </li>
                    ))}
                  </ul>
                )}
                {tab === 'waiting' && <SuggestFromRunsCard agentId={agentId} onSuggested={reload} />}
                {tab === 'inUse' && learning.canBecomeSkill && <SkillFromNotesCard agentId={agentId} />}
                {tab === 'inUse' && <AddNoteForm agentId={agentId} onAdded={reload} />}
              </>
            )}
            <PeopleSection learning={learning} onChanged={reload} />
          </>
        )}
      </PageFrame>
    </AppShell>
  )
}
