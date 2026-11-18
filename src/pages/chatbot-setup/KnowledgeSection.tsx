import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { KnowledgeBase, KnowledgeBaseDetail, KnowledgeSource } from '@/api/knowledgeTypes'
import { joinClassNames } from '@/components/ui'
import { knowledgeDetailPath, routePaths } from '@/routes'
import { SectionHeading, compactButtonClassNames, fieldControlClassNames } from '../knowledge/FormControls'
import { SourceTypeTile, detectSourceType } from '../knowledge/SourceTypeTile'
import { listRowClassNames } from './ChatbotSetupSections'

/**
 * Knowledge of the chatbot setup (screen 14): the knowledge bases the bot answers from,
 * each with its sources, plus adding (attaching) one of your knowledge bases and removing
 * (detaching) one. Sources themselves are managed on the knowledge detail screen (18).
 */

function describeSource(source: KnowledgeSource): { text: string; isProgress: boolean } {
  switch (source.status) {
    case 'indexed':
      return { text: `${source.passageCount} passages · ready`, isProgress: false }
    case 'failed':
      return { text: source.statusMessage ?? 'Could not be read', isProgress: false }
    default:
      return { text: 'Reading…', isProgress: true }
  }
}

function SourceRow({ source, isLast }: { source: KnowledgeSource; isLast: boolean }) {
  const description = describeSource(source)
  return (
    <li className={joinClassNames(listRowClassNames, !isLast && 'border-b border-chip')}>
      <SourceTypeTile type={source.kind === 'url' ? 'WEB' : detectSourceType(source.name)} />
      <span className="flex flex-auto flex-col">
        <span className="font-medium">{source.name}</span>
        <span className={joinClassNames('text-[12px]', description.isProgress ? 'text-brand-strong' : 'text-muted')}>{description.text}</span>
      </span>
    </li>
  )
}

function AttachedKnowledgeBase({ detail, isBusy, onDetach }: { detail: KnowledgeBaseDetail; isBusy: boolean; onDetach: () => void }) {
  const { knowledgeBase, sources } = detail
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Link to={knowledgeDetailPath(knowledgeBase.id)} className="text-[13px] font-medium">
          {knowledgeBase.name} · Manage
        </Link>
        <button
          type="button"
          aria-label={`Remove ${knowledgeBase.name}`}
          disabled={isBusy}
          onClick={onDetach}
          className="size-8 cursor-pointer rounded-lg border-0 bg-transparent text-muted hover:bg-chip"
        >
          ×
        </button>
      </div>
      {sources.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">No files or links in it yet</p>
      ) : (
        <ul className="m-0 list-none rounded-xl border border-line p-0">
          {sources.map((source, index) => (
            <SourceRow key={source.id} source={source} isLast={index === sources.length - 1} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AttachForm({ available, isBusy, onAttach, onCancel }: { available: KnowledgeBase[]; isBusy: boolean; onAttach: (knowledgeBaseId: string) => void; onCancel: () => void }) {
  const [chosenId, setChosenId] = useState(available[0]?.id ?? '')
  if (available.length === 0) {
    return (
      <p className="m-0 text-[13px] text-muted">
        No other knowledge bases yet. <Link to={routePaths.knowledge}>Create one in Knowledge</Link>
      </p>
    )
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (chosenId) onAttach(chosenId)
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label className="flex flex-auto flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-2">Knowledge base</span>
        <select value={chosenId} onChange={(event) => setChosenId(event.target.value)} className={joinClassNames(fieldControlClassNames, 'px-2.5')}>
          {available.map((knowledgeBase) => (
            <option key={knowledgeBase.id} value={knowledgeBase.id}>
              {knowledgeBase.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2 self-end">
        <button type="submit" disabled={isBusy} className={compactButtonClassNames('primary')}>
          Use it
        </button>
        <button type="button" onClick={onCancel} className={compactButtonClassNames('secondary')}>
          Cancel
        </button>
      </div>
    </form>
  )
}

interface KnowledgeSectionProps {
  attached: KnowledgeBaseDetail[]
  /** Your knowledge bases not attached yet. */
  available: KnowledgeBase[]
  isBusy: boolean
  onAttach: (knowledgeBaseId: string) => void
  onDetach: (knowledgeBaseId: string) => void
}

export function KnowledgeSection({ attached, available, isBusy, onAttach, onDetach }: KnowledgeSectionProps) {
  const [isPicking, setIsPicking] = useState(false)
  return (
    <section aria-labelledby="k-h" className="flex flex-col gap-3">
      <SectionHeading id="k-h">Knowledge</SectionHeading>
      {attached.length === 0 && <p className="m-0 text-[13px] text-muted">The chatbot does not answer from any knowledge yet</p>}
      {attached.map((detail) => (
        <AttachedKnowledgeBase key={detail.knowledgeBase.id} detail={detail} isBusy={isBusy} onDetach={() => onDetach(detail.knowledgeBase.id)} />
      ))}
      {isPicking ? (
        <AttachForm
          available={available}
          isBusy={isBusy}
          onCancel={() => setIsPicking(false)}
          onAttach={(knowledgeBaseId) => {
            setIsPicking(false)
            onAttach(knowledgeBaseId)
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsPicking(true)}
          className="h-12 cursor-pointer rounded-xl border border-dashed border-line-heavy bg-subtle text-[14px] font-medium text-ink-2 hover:bg-canvas"
        >
          Add a knowledge base
        </button>
      )}
    </section>
  )
}
