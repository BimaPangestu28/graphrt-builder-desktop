import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { Icon, joinClassNames } from '@/components/ui'
import { agentKindOptions, agentTemplates, buildPathByAgentKind, defaultJobDescription, type AgentKind, type AgentTemplate } from '@/data/newAgentTemplates'

/** Pill radio group for choosing what kind of agent to make. */
function AgentKindPicker({ selectedKind, onSelect }: { selectedKind: AgentKind; onSelect: (kind: AgentKind) => void }) {
  return (
    <fieldset className="m-0 flex flex-wrap justify-center gap-2 border-0 p-0">
      <legend className="sr-only">What are you making</legend>
      {agentKindOptions.map((option) => {
        const isSelected = option.value === selectedKind
        return (
          <label
            key={option.value}
            className={joinClassNames(
              'flex h-9 cursor-pointer items-center gap-2 rounded-full border bg-surface px-3.5',
              isSelected ? 'border-ink font-semibold' : 'border-line-strong font-medium',
            )}
          >
            <input type="radio" name="kind" value={option.value} checked={isSelected} onChange={() => onSelect(option.value)} className="m-0 accent-ink" />
            {option.label}
          </label>
        )
      })}
    </fieldset>
  )
}

/** Grey info chip under the prompt (runtime location, model). */
function PromptChip({ children }: { children: ReactNode }) {
  return <span className="flex h-[30px] items-center gap-1.5 rounded-lg bg-canvas px-2.5 text-[13px] text-ink-2">{children}</span>
}

function TemplateCard({ template }: { template: AgentTemplate }) {
  return (
    <Link to={template.path} className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-[18px] no-underline !text-ink hover:border-line-heavy">
      {template.kindLabel ? (
        <span className="flex items-center justify-between gap-2">
          <span className="font-semibold">{template.title}</span>
          <span className="text-[11px] font-semibold text-brand-strong">{template.kindLabel}</span>
        </span>
      ) : (
        <span className="font-semibold">{template.title}</span>
      )}
      <span className="leading-normal text-body">{template.description}</span>
      <span className="text-[12px] text-muted">{template.meta}</span>
    </Link>
  )
}

/**
 * Screen 02 · New agent. The empty-state home before any agent exists:
 * pick a kind, describe the job in plain words and press "Build agent",
 * or start from one of the templates below.
 */
export function NewAgentPage() {
  const navigate = useNavigate()
  const [selectedKind, setSelectedKind] = useState<AgentKind>('task')
  const [jobDescription, setJobDescription] = useState(defaultJobDescription)
  const canBuild = jobDescription.trim().length > 0

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canBuild) navigate(buildPathByAgentKind[selectedKind], { state: { jobDescription } })
  }

  return (
    <AppShell agents={{ kind: 'empty' }} runnerStatus="Online · OpenAI connected" mainClassName="flex flex-col items-center gap-12 px-8 pt-[72px] pb-12">
      <form onSubmit={handleSubmit} className="flex w-full max-w-[760px] flex-col gap-5">
        <h1 className="m-0 text-center text-[36px] font-semibold tracking-[-0.8px]">What should your agent do?</h1>
        <AgentKindPicker selectedKind={selectedKind} onSelect={setSelectedKind} />
        <label htmlFor="task" className="sr-only">
          Describe the job
        </label>
        <div className="flex flex-col gap-3.5 rounded-[18px] border border-line-strong bg-surface px-[18px] pt-[18px] pb-3.5">
          <textarea
            id="task"
            rows={4}
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            className="resize-none border-0 bg-transparent text-[16px] leading-[1.6] text-ink outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap gap-2">
              <PromptChip>
                <Icon name="monitor" size={14} />
                Runs on this Mac
              </PromptChip>
              <PromptChip>gpt-4o-mini</PromptChip>
            </div>
            <button
              type="submit"
              disabled={!canBuild}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-[9px] border-0 bg-ink px-[18px] text-[14px] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Build agent
              <Icon name="arrowRight" size={16} />
            </button>
          </div>
        </div>
        <p className="m-0 text-center text-muted">Not sure which kind? Just describe it and graphrt picks. You see every step before anything runs</p>
      </form>

      <section aria-label="Templates" className="flex w-full max-w-[960px] flex-col gap-3.5">
        <span className="font-semibold">Or start from a template</span>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {agentTemplates.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      </section>
    </AppShell>
  )
}
