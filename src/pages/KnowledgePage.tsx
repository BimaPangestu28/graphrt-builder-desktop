import { useState } from 'react'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Icon } from '@/components/ui'
import { addKnowledgeSource, createKnowledgeBase, isWebLink } from '@/api/knowledge'
import { FileDropZone } from '@/components/fileDrop'
import type { KnowledgeSourceKind } from '@/api/knowledgeTypes'
import { useKnowledgeBases, useKnowledgeSearch } from '@/hooks/useKnowledge'
import { AddLinkForm } from './knowledge/AddLinkForm'
import { compactButtonClassNames } from './knowledge/FormControls'
import { KnowledgeBaseCard } from './knowledge/KnowledgeBaseCard'
import { PassageMatch, SearchFieldIcon } from './knowledge/PassageMatch'
import { knowledgeDropAccept, knowledgeDropHint } from './knowledge/knowledgeDrop'
import { useSourcePicker } from './knowledge/useSourcePicker'
import { toError } from '@/lib/errors'

/** Something to index: a file, a folder or a link. */
interface NewSource {
  kind: KnowledgeSourceKind
  location: string
}

/**
 * Names a new knowledge base after what it starts with.
 *
 * @example
 * nameForNewKnowledgeBase([{ kind: 'file', location: '/Users/me/Menu.pdf' }]) // "Menu.pdf"
 */
export function nameForNewKnowledgeBase(newSources: NewSource[]): string {
  if (newSources.length !== 1) return 'New knowledge base'
  const [{ kind, location }] = newSources
  if (kind === 'url') return location.replace(/^https?:\/\//i, '').split('/')[0] || 'New knowledge base'
  return location.split(/[\\/]/).filter(Boolean).pop() ?? 'New knowledge base'
}

function KnowledgeSearchPanel() {
  const [searchQuery, setSearchQuery] = useState('')
  const { passages, isSearching, error } = useKnowledgeSearch(searchQuery, undefined, 4)

  return (
    <section aria-labelledby="ask-h" className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-subtle p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ask-h" className="m-0 text-[15px] font-semibold">
          Search across all knowledge
        </h2>
        <span className="text-[12px] text-muted">Shows exactly what an agent would find</span>
      </div>
      <label className="box-border flex h-11 items-center gap-2.5 rounded-[10px] border border-line-strong bg-surface px-3.5 focus-within:border-brand">
        <SearchFieldIcon />
        <input
          type="search"
          aria-label="Search knowledge"
          placeholder="Ask something your agents should know"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-none"
        />
      </label>
      <div className="flex flex-col gap-2" aria-live="polite">
        {error && <p className="m-0 text-[13px] text-danger">Could not search: {error.message}</p>}
        {passages.map((passage) => (
          <PassageMatch key={passage.id} passage={passage} />
        ))}
        {!error && !isSearching && searchQuery.trim() !== '' && passages.length === 0 && (
          <p className="m-0 text-[13px] text-muted">Nothing in your knowledge matches this yet</p>
        )}
      </div>
    </section>
  )
}

/**
 * Screen 17 · Knowledge.
 * Every knowledge base agents and chatbots can look things up in, as cards linking to the
 * detail screen (18). "New knowledge base", the drop zone (drop files or a folder, choose files
 * or paste a link) and
 * the folder/link controls create a knowledge base that starts indexing in the background.
 * The search box searches every knowledge base the way an agent would.
 */
export function KnowledgePage() {
  const { data: knowledgeBases, error: loadError, isLoading, reload, setData } = useKnowledgeBases()
  const [actionError, setActionError] = useState<string | null>(null)

  const createFromSources = async (newSources: NewSource[]) => {
    setActionError(null)
    try {
      const knowledgeBase = await createKnowledgeBase(nameForNewKnowledgeBase(newSources))
      setData((current) => [knowledgeBase, ...(current ?? [])])
      for (const newSource of newSources) {
        await addKnowledgeSource(knowledgeBase.id, newSource.kind, newSource.location)
      }
      reload()
    } catch (creationError) {
      setActionError(toError(creationError).message)
      reload()
    }
  }
  const { pickFiles, pickFolder, pickerInputs } = useSourcePicker(
    (picked) => void createFromSources(picked.locations.map((location) => ({ kind: picked.kind, location }))),
    (pickError) => setActionError(toError(pickError).message),
    { files: 'Choose files for a new knowledge base', folder: 'Choose a folder for a new knowledge base' },
  )

  return (
    <AppShell activeNav="knowledge" agents={{ kind: 'list' }}>
      <PageFrame>
        <PageTitleBlock
          title="Knowledge"
          subtitle="What your agents and chatbots can look things up in. Everything is indexed and stored on this computer"
          actions={
              <button
                type="button"
                onClick={pickFiles}
                className="flex h-10 cursor-pointer items-center gap-2 rounded-[9px] border-0 bg-ink px-4 text-[14px] font-semibold text-white hover:bg-ink-2"
              >
                <Icon name="plus" size={16} />
                New knowledge base
              </button>
          }
        />

        {actionError && (
          <p role="alert" className="m-0 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3 text-[13px] text-danger">
            {actionError}
          </p>
        )}
        {loadError && (
          <p role="alert" className="m-0 flex items-center gap-3 text-[13px] text-danger">
            Could not load your knowledge: {loadError.message}
            <button type="button" onClick={reload} className={compactButtonClassNames('secondary')}>
              Try again
            </button>
          </p>
        )}
        {isLoading && !knowledgeBases && <p className="m-0 text-[13px] text-muted">Loading knowledge…</p>}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {(knowledgeBases ?? []).map((knowledgeBase, index) => (
            <KnowledgeBaseCard key={knowledgeBase.id} knowledgeBase={knowledgeBase} isRecentlyOpened={index === 0} />
          ))}
          <FileDropZone
            itemDescription="files or a folder"
            accept={knowledgeDropAccept}
            multiple
            onDrop={(droppedItems) => void createFromSources(droppedItems.map((item) => ({ kind: item.kind, location: item.path })))}
            chooseLabel="Choose files…"
            onChoose={pickFiles}
            hint={`${knowledgeDropHint}, or paste a website link`}
            onPaste={(event) => {
              const pastedText = event.clipboardData.getData('text')
              if (isWebLink(pastedText)) void createFromSources([{ kind: 'url', location: pastedText.trim() }])
            }}
          />
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <button type="button" onClick={pickFolder} className={compactButtonClassNames('secondary', 'h-10')}>
            Start from a folder
          </button>
          <div className="min-w-[280px] flex-1">
            <AddLinkForm
              label="Website link for a new knowledge base"
              buttonText="Start from a link"
              onAddLink={(url) => createFromSources([{ kind: 'url', location: url }])}
            />
          </div>
        </div>
        {pickerInputs}

        <KnowledgeSearchPanel />
      </PageFrame>
    </AppShell>
  )
}
