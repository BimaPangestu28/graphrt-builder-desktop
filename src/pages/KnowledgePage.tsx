import { useState } from 'react'
import { AppShell } from '@/components/layout'
import { Icon } from '@/components/ui'
import { knowledgeBases, searchKnowledgePassages, type KnowledgeBase } from '@/data/knowledge'
import { KnowledgeBaseCard } from './knowledge/KnowledgeBaseCard'
import { PassageMatch, SearchFieldIcon } from './knowledge/PassageMatch'
import { useFilePicker } from './knowledge/useFilePicker'

/**
 * Builds a new, still-indexing knowledge base from files the user picked.
 *
 * @param fileNames - Names of the picked files
 * @param sequenceNumber - Used to keep ids unique within the session
 */
function createKnowledgeBaseFromFiles(fileNames: string[], sequenceNumber: number): KnowledgeBase {
  return {
    id: `new-knowledge-${sequenceNumber}`,
    name: fileNames.length === 1 ? fileNames[0] : 'New knowledge base',
    status: { kind: 'syncing', percent: 0 },
    facts: [fileNames.length === 1 ? '1 file' : `${fileNames.length} files`],
    usedBy: [],
  }
}

function KnowledgeSearchPanel() {
  const [searchQuery, setSearchQuery] = useState('minimum order for free delivery')
  const matchingPassages = searchKnowledgePassages(searchQuery)

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
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-none"
        />
      </label>
      <div className="flex flex-col gap-2" aria-live="polite">
        {matchingPassages.map((passage) => (
          <PassageMatch key={passage.id} passage={passage} />
        ))}
        {searchQuery.trim() !== '' && matchingPassages.length === 0 && <p className="m-0 text-[13px] text-muted">Nothing in your knowledge matches this yet</p>}
      </div>
    </section>
  )
}

/**
 * Screen 17 · Knowledge.
 * Every knowledge base agents and chatbots can look things up in, as cards linking to the
 * detail screen (18), a drop zone to add files, and a live search across all passages.
 * Picking files (via "New knowledge base" or the drop zone) adds a syncing card locally.
 */
export function KnowledgePage() {
  const [visibleKnowledgeBases, setVisibleKnowledgeBases] = useState<KnowledgeBase[]>(knowledgeBases)
  const { openFilePicker, filePickerInput } = useFilePicker(
    (fileNames) => setVisibleKnowledgeBases((previousBases) => [...previousBases, createKnowledgeBaseFromFiles(fileNames, previousBases.length)]),
    'Choose files for a new knowledge base',
  )

  return (
    <AppShell activeNav="knowledge" agents={{ kind: 'list' }} mainClassName="box-border flex flex-col gap-6 px-8 py-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.5px]">Knowledge</h1>
          <span className="text-body">What your agents and chatbots can look things up in. Everything is indexed and stored on this Mac</span>
        </div>
        <button
          type="button"
          onClick={openFilePicker}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-[9px] border-0 bg-ink px-4 text-[14px] font-semibold text-white hover:bg-ink-2"
        >
          <Icon name="plus" size={16} />
          New knowledge base
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        {visibleKnowledgeBases.map((knowledgeBase) => (
          <KnowledgeBaseCard key={knowledgeBase.id} knowledgeBase={knowledgeBase} />
        ))}
        <button
          type="button"
          onClick={openFilePicker}
          className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-line-heavy bg-subtle p-[18px] text-[14px] font-medium text-ink-2 hover:bg-canvas"
        >
          <span>Drop files, a folder, or paste a link</span>
          <span className="text-[12px] font-normal text-muted">PDF, Word, Excel, CSV, Markdown, websites, Google Drive</span>
        </button>
      </div>
      {filePickerInput}

      <KnowledgeSearchPanel />
    </AppShell>
  )
}
