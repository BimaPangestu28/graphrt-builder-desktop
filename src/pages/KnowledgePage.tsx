import { useState } from 'react'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Button, Icon } from '@/components/ui'
import { addKnowledgeSource, createKnowledgeBase, isWebLink } from '@/api/knowledge'
import { FileDropZone } from '@/components/fileDrop'
import type { KnowledgeSourceKind } from '@/api/knowledgeTypes'
import { useKnowledgeBases, useKnowledgeSearch } from '@/hooks/useKnowledge'
import { AddLinkForm } from './knowledge/AddLinkForm'
import { compactButtonClassNames, SectionHeading } from './knowledge/FormControls'
import { KnowledgeBaseCard } from './knowledge/KnowledgeBaseCard'
import { PassageMatch, SearchFieldIcon } from './knowledge/PassageMatch'
import { knowledgeDropAccept, knowledgeDropHint } from './knowledge/knowledgeDrop'
import { useSourcePicker } from './knowledge/useSourcePicker'
import { toError } from '@/lib/errors'
import { messages, useT } from '@/i18n'

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
  const fallbackName = messages().knowledge.newKnowledgeBase
  if (newSources.length !== 1) return fallbackName
  const [{ kind, location }] = newSources
  if (kind === 'url') return location.replace(/^https?:\/\//i, '').split('/')[0] || fallbackName
  return location.split(/[\\/]/).filter(Boolean).pop() ?? fallbackName
}

function KnowledgeSearchPanel() {
  const t = useT().knowledge
  const [searchQuery, setSearchQuery] = useState('')
  const { passages, isSearching, error } = useKnowledgeSearch(searchQuery, undefined, 4)

  return (
    <section aria-labelledby="ask-h" className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-subtle p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ask-h" className="m-0 text-[15px] font-semibold">
          {t.searchAcross}
        </h2>
        <span className="text-[12px] text-muted">{t.searchHint}</span>
      </div>
      <label className="box-border flex h-11 items-center gap-2.5 rounded-[10px] border border-line-strong bg-surface px-3.5 focus-within:border-brand">
        <SearchFieldIcon />
        <input
          type="search"
          aria-label={t.searchLabel}
          placeholder={t.searchPlaceholder}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-none"
        />
      </label>
      <div className="flex flex-col gap-2 empty:hidden" aria-live="polite">
        {error && <p className="m-0 text-[13px] text-danger">{t.couldNotSearch(error.message)}</p>}
        {passages.map((passage) => (
          <PassageMatch key={passage.id} passage={passage} />
        ))}
        {!error && !isSearching && searchQuery.trim() !== '' && passages.length === 0 && (
          <p className="m-0 text-[13px] text-muted">{t.nothingMatches}</p>
        )}
      </div>
    </section>
  )
}

/** Shown in place of the list until the first knowledge base exists. */
function KnowledgeEmptyState() {
  const t = useT().knowledge
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[14px] border border-line bg-subtle px-6 py-10 text-center">
      <span aria-hidden="true" className="mb-1 text-muted">
        <Icon name="file" size={22} />
      </span>
      <p className="m-0 text-[15px] font-semibold text-ink">{t.noKnowledgeYet}</p>
      <p className="m-0 max-w-[72ch] text-[13px] leading-normal text-body">{t.noKnowledgeHint}</p>
    </div>
  )
}

/**
 * Screen 17 · Knowledge.
 * One "Add knowledge" card (drop files or a folder, choose files, choose a folder or paste a
 * website link) where everything added starts a new knowledge base that indexes in the
 * background. Below it, every knowledge base as a card linking to the detail screen (18), or a
 * short empty state. Once there is knowledge, the search box searches all of it the way an agent would.
 */
export function KnowledgePage() {
  const t = useT().knowledge
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
    { files: t.pickFilesNew, folder: t.pickFolderNew },
  )
  const hasKnowledge = (knowledgeBases?.length ?? 0) > 0

  return (
    <AppShell activeNav="knowledge" agents={{ kind: 'list' }}>
      <PageFrame>
        <PageTitleBlock title={t.title} subtitle={t.subtitle} />

        {actionError && (
          <p role="alert" className="m-0 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3 text-[13px] text-danger">
            {actionError}
          </p>
        )}

        <section aria-labelledby="add-knowledge-h" className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-5">
          <div className="flex flex-col gap-1">
            <SectionHeading id="add-knowledge-h">{t.addKnowledge}</SectionHeading>
            <span className="text-[13px] text-body">{t.addKnowledgeHint}</span>
          </div>
          <FileDropZone
            itemDescription={t.filesOrFolder}
            accept={knowledgeDropAccept}
            multiple
            onDrop={(droppedItems) => void createFromSources(droppedItems.map((item) => ({ kind: item.kind, location: item.path })))}
            chooseLabel={t.chooseFiles}
            onChoose={pickFiles}
            secondaryActions={
              <Button variant="secondary" size="sm" onClick={pickFolder}>
                {t.chooseFolder}
              </Button>
            }
            hint={knowledgeDropHint()}
            onPaste={(event) => {
              const pastedText = event.clipboardData.getData('text')
              if (isWebLink(pastedText)) void createFromSources([{ kind: 'url', location: pastedText.trim() }])
            }}
          />
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-ink-2">{t.orAddWebsite}</span>
            <AddLinkForm
              label={t.websiteLinkNew}
              buttonText={t.addWebsite}
              onAddLink={(url) => createFromSources([{ kind: 'url', location: url }])}
            />
          </div>
          {pickerInputs}
        </section>

        <section aria-labelledby="knowledge-bases-h" className="flex flex-col gap-3">
          <div className="flex min-h-7 items-center gap-2">
            <SectionHeading id="knowledge-bases-h">{t.yourKnowledgeBases}</SectionHeading>
            {hasKnowledge && <span className="rounded-full bg-canvas px-2 py-[2px] text-[12px] font-medium text-ink-2">{knowledgeBases?.length}</span>}
          </div>
          {loadError && (
            <p role="alert" className="m-0 flex items-center gap-3 text-[13px] text-danger">
              {t.couldNotLoad(loadError.message)}
              <button type="button" onClick={reload} className={compactButtonClassNames('secondary')}>
                {t.tryAgain}
              </button>
            </p>
          )}
          {isLoading && !knowledgeBases && <p className="m-0 text-[13px] text-muted">{t.loading}</p>}
          {knowledgeBases && !hasKnowledge && <KnowledgeEmptyState />}
          {hasKnowledge && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
              {(knowledgeBases ?? []).map((knowledgeBase, index) => (
                <KnowledgeBaseCard key={knowledgeBase.id} knowledgeBase={knowledgeBase} isRecentlyOpened={index === 0} />
              ))}
            </div>
          )}
        </section>

        {hasKnowledge && <KnowledgeSearchPanel />}
      </PageFrame>
    </AppShell>
  )
}
