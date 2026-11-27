import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { Icon, joinClassNames } from '@/components/ui'
import {
  agentKindOptions,
  agentTemplates,
  findAgentTemplate,
  jobDescriptionPlaceholder,
  templatePromptText,
  type AgentKind,
  type AgentTemplate,
} from '@/pages/new-agent/agentTemplates'
import type { BuildRequestLocationState } from './agent-builder/buildRequestState'
import { ModelPickerChip } from './new-agent/ModelPickerChip'
import { messages, useLocale } from '@/i18n'
import { createAgentFromPluginTemplate, listPluginTemplates } from '@/api/plugins'
import { describeError } from '@/lib/agentDisplay'
import { agentPath, routePaths } from '@/routes'
import { useAsyncData } from '@/hooks/useAsyncData'
import { pluginTemplateCards } from './new-agent/pluginTemplates'

/** Pill radio group for choosing what kind of agent to make. */
function AgentKindPicker({ selectedKind, onSelect }: { selectedKind: AgentKind; onSelect: (kind: AgentKind) => void }) {
  return (
    <fieldset className="m-0 flex flex-wrap justify-center gap-2 border-0 p-0">
      <legend className="sr-only">{messages().newAgent.whatAreYouMaking}</legend>
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

/** Small grey chip naming one plugin or connection a template needs. */
function TemplateNeedChip({ label }: { label: string }) {
  return (
    <span role="listitem" className="rounded-md bg-canvas px-2 py-0.5 text-[12px] font-medium text-ink-2">
      {label}
    </span>
  )
}

/**
 * A starter: picking it fills the prompt and the kind; it builds nothing by itself. The
 * exception is a card tagged "Ready to use" (an agent a plugin ships finished), which the
 * page makes at once. Every card has the same rows: title (and kind tag), what it does, what it needs (chips),
 * a short setup note, and the services/size line at the bottom.
 */
function TemplateCard({ template, isDisabled, onPick }: { template: AgentTemplate; isDisabled: boolean; onPick: (template: AgentTemplate) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(template)}
      disabled={isDisabled}
      className="flex h-full cursor-pointer flex-col gap-2 rounded-[14px] border border-line bg-surface p-[18px] text-left text-ink hover:border-line-heavy disabled:cursor-wait disabled:opacity-60"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-semibold">{template.title}</span>
        {template.kindLabel ? <span className="shrink-0 text-[11px] font-semibold text-brand-strong">{template.kindLabel}</span> : null}
      </span>
      <span className="leading-normal text-body">{template.description}</span>
      <span className="mt-auto flex flex-col gap-1.5 pt-1">
        <span role="list" aria-label={messages().newAgent.titleNeeds(template.title)} className="flex flex-wrap gap-1.5">
          {template.needs.map((need) => (
            <TemplateNeedChip key={need} label={need} />
          ))}
        </span>
        <span className="text-[12px] text-ink-2">{messages().newAgent.youllNeed}{' '}{template.setupNote}</span>
      </span>
      <span className="text-[12px] text-muted">{template.meta}</span>
    </button>
  )
}

/**
 * Screen 02 · New agent. The empty-state home before any agent exists:
 * pick a kind, describe the job in plain words and press "Build agent",
 * or pick a template below to fill in the description and kind as a starting point
 * (`?template=<id>` opens it with that template already picked, e.g. from Home).
 * The chip under the prompt shows the real default model. "Build agent" hands the request
 * (`{ buildRequest }` router state) to Generating (03), whatever the kind: the backend builds a
 * new agent of that kind, and a chatbot then opens its own setup (14). A "Ready to use" card of an
 * installed plugin skips all of that: the agent is made from the plugin's workflow and its
 * test form opens, with no model involved.
 */
export function NewAgentPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [initialTemplate] = useState(() => findAgentTemplate(searchParams.get('template')))
  // Templates of installed plugins (e.g. the Upwork MCP preset); none when they cannot be read.
  const pluginTemplates = useAsyncData(listPluginTemplates, [])
  const [selectedKind, setSelectedKind] = useState<AgentKind>(initialTemplate?.kind ?? 'task')
  const [jobDescription, setJobDescription] = useState(initialTemplate ? templatePromptText(initialTemplate) : '')
  const jobDescriptionRef = useRef<HTMLTextAreaElement>(null)
  const canBuild = jobDescription.trim().length > 0
  const locale = useLocale()
  /** Title of the ready-made agent being made; every card waits meanwhile. */
  const [makingTitle, setMakingTitle] = useState<string | null>(null)
  const [makeError, setMakeError] = useState<string | null>(null)

  async function makeReadyAgent(template: AgentTemplate, readyAgent: NonNullable<AgentTemplate['readyAgent']>) {
    setMakingTitle(template.title)
    setMakeError(null)
    try {
      const agent = await createAgentFromPluginTemplate(readyAgent.plugin, readyAgent.templateId)
      navigate(agentPath('testRun', agent.id))
    } catch (createError) {
      setMakeError(messages().newAgent.couldNotMakeAgent(template.title, describeError(createError)))
      setMakingTitle(null)
    }
  }

  function handleTemplatePick(template: AgentTemplate) {
    if (template.readyAgent) {
      void makeReadyAgent(template, template.readyAgent)
      return
    }
    setSelectedKind(template.kind)
    setJobDescription(templatePromptText(template))
    jobDescriptionRef.current?.focus()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canBuild) return
    const locationState: BuildRequestLocationState = { buildRequest: { description: jobDescription.trim(), kind: selectedKind } }
    navigate(routePaths.generating, { state: locationState })
  }

  return (
    <AppShell agents={{ kind: 'empty' }} runnerStatus={messages().newAgent.onlineOpenaiConnected} mainClassName="flex flex-col items-center gap-12 px-8 pt-[72px] pb-12">
      <form onSubmit={handleSubmit} className="flex w-full max-w-[760px] flex-col gap-5">
        <h1 className="m-0 text-center text-[36px] font-semibold tracking-[-0.8px]">{messages().newAgent.whatShouldYourAgentDo}</h1>
        <AgentKindPicker selectedKind={selectedKind} onSelect={setSelectedKind} />
        <label htmlFor="task" className="sr-only">
          {messages().newAgent.describeTheJob}
        </label>
        <div className="flex flex-col gap-3.5 rounded-[18px] border border-line-strong bg-surface px-[18px] pt-[18px] pb-3.5">
          <textarea
            id="task"
            ref={jobDescriptionRef}
            rows={4}
            value={jobDescription}
            placeholder={jobDescriptionPlaceholder()}
            onChange={(event) => setJobDescription(event.target.value)}
            className="resize-none border-0 bg-transparent text-[16px] leading-[1.6] text-ink outline-none placeholder:text-muted"
          />
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap gap-2">
              <PromptChip>
                <Icon name="monitor" size={14} />
                {messages().newAgent.runsOnThisComputer}
              </PromptChip>
              <ModelPickerChip />
            </div>
            <button
              type="submit"
              disabled={!canBuild}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-[9px] border-0 bg-ink px-[18px] text-[14px] font-semibold text-inverse hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {messages().newAgent.buildAgent}
              <Icon name="arrowRight" size={16} />
            </button>
          </div>
        </div>
        <p className="m-0 text-center text-muted">{messages().newAgent.notSureWhichKindJustDescribe}</p>
      </form>

      <section aria-label={messages().newAgent.templates} className="flex w-full max-w-[960px] flex-col gap-3.5">
        <span className="font-semibold">{messages().newAgent.orStartFromATemplate}</span>
        {makingTitle && (
          <p role="status" className="m-0 text-[13px] text-body">
            {messages().newAgent.makingAgent(makingTitle)}
          </p>
        )}
        {makeError && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {makeError}
          </p>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {[...agentTemplates, ...pluginTemplateCards(pluginTemplates.data ?? [], locale)].map((template) => (
            <TemplateCard key={template.id} template={template} isDisabled={makingTitle !== null} onPick={handleTemplatePick} />
          ))}
        </div>
      </section>
    </AppShell>
  )
}
