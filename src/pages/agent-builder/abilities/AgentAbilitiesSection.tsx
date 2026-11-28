import { useId, useState } from 'react'
import { getAgentAbilities, setAgentAbility, setAgentSpendingLimit } from '@/api/abilities'
import type { AgentAbilities } from '@/api/abilitiesTypes'
import { isBackendErrorWithCode } from '@/api/client'
import { Button, Card, joinClassNames } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useT } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'
import { ContextEditor, HelpersEditor, MemoryEditor, SpendingEditor, type SaveAbilities } from './AbilityEditors'
import { abilityUnavailableReason, summarizeContext, summarizeHelpers, summarizeMemory, summarizeSpending } from './abilitiesDisplay'

export type AbilityKey = 'context' | 'memory' | 'helpers' | 'spending'

const abilityKeys: readonly AbilityKey[] = ['memory', 'helpers', 'context', 'spending']

interface AgentAbilitiesSectionProps {
  agentId: string
  /** Reloads when the agent gets a new version (a change here, the builder or Nodes). */
  agentVersion: number
  /** After a change saved a new version: reload the agent, its steps and the chat. */
  onSaved?: () => void
}

interface AbilityCardProps {
  title: string
  summary: string
  unavailableReason: string | null
  isOpen: boolean
  onOpen: () => void
}

/** One ability at a glance: its name, what it does now on one line, and Change. */
function AbilityCard({ title, summary, unavailableReason, isOpen, onOpen }: AbilityCardProps) {
  const t = useT().abilities.section
  return (
    <Card className={joinClassNames('flex min-w-0 items-center gap-3 p-3.5', isOpen && 'border-ink')}>
      <div className="flex min-w-0 flex-auto flex-col gap-0.5">
        <span title={title} className="truncate text-[14px] font-semibold text-ink">
          {title}
        </span>
        <span title={unavailableReason ?? summary} className="truncate text-[12.5px] text-muted">
          {unavailableReason ?? summary}
        </span>
      </div>
      <Button variant="secondary" size="sm" onClick={onOpen} disabled={unavailableReason !== null} aria-expanded={isOpen} aria-label={`${t.change}: ${title}`}>
        {t.change}
      </Button>
    </Card>
  )
}

/**
 * "What this agent can do" on the agent's Steps tab: long conversations, remembering people,
 * asking other agents for help and the spending limit per run, each a card with a one-line
 * summary. Change opens the ability's editor under the cards (one at a time); saving an
 * ability that lives in the steps makes a new version, the spending limit does not.
 */
export function AgentAbilitiesSection({ agentId, agentVersion, onSaved }: AgentAbilitiesSectionProps) {
  const all = useT().abilities
  const t = all.section
  const headingId = useId()
  const state = useAsyncData(() => getAgentAbilities(agentId), [agentId, agentVersion])
  const [openAbility, setOpenAbility] = useState<AbilityKey | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const abilities = state.data

  function open(key: AbilityKey) {
    setSaveError(null)
    setSavedNotice(null)
    setOpenAbility((current) => (current === key ? null : key))
  }

  const save: SaveAbilities = async (changes) => {
    setIsSaving(true)
    setSaveError(null)
    try {
      if ('spending' in changes) {
        await setAgentSpendingLimit(agentId, changes.spending)
      } else {
        for (const change of changes) await setAgentAbility(agentId, change)
        setSavedNotice(t.saved)
        onSaved?.()
      }
      setOpenAbility(null)
      await state.reload()
      return true
    } catch (error) {
      setSaveError(isBackendErrorWithCode(error, 'builder_busy') ? t.builderBusy : t.couldNotSave(describeError(error)))
      // A change before the failing one may have saved: show what is saved now.
      await state.reload()
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const summaries = abilities ? summarize(abilities, all) : null
  const editorProps = abilities ? { abilities, isSaving, error: saveError, onCancel: () => setOpenAbility(null), onSave: save } : null

  return (
    <section aria-labelledby={headingId} className="@container flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 id={headingId} className="m-0 text-[15px] font-semibold text-ink">
          {t.title}
        </h3>
        <p className="m-0 text-[13px] leading-normal text-body">{t.subtitle}</p>
      </div>
      {state.error && !abilities && <p className="m-0 text-[13px] text-danger">{t.couldNotLoad(describeError(state.error))}</p>}
      {!abilities && !state.error && <p className="m-0 text-[13px] text-muted">{t.loading}</p>}
      {abilities && summaries && (
        <ul className="m-0 grid min-w-0 list-none grid-cols-1 gap-2.5 p-0 @xl:grid-cols-2">
          {abilityKeys.map((key) => (
            <li key={key} className="min-w-0">
              <AbilityCard title={summaries[key].title} summary={summaries[key].summary} unavailableReason={summaries[key].unavailable} isOpen={openAbility === key} onOpen={() => open(key)} />
            </li>
          ))}
        </ul>
      )}
      {editorProps && openAbility === 'context' && <ContextEditor {...editorProps} />}
      {editorProps && openAbility === 'memory' && <MemoryEditor {...editorProps} />}
      {editorProps && openAbility === 'helpers' && <HelpersEditor {...editorProps} />}
      {editorProps && openAbility === 'spending' && <SpendingEditor {...editorProps} />}
      {savedNotice && openAbility === null && (
        <p role="status" className="m-0 text-[12.5px] text-ok-strong">
          {savedNotice}
        </p>
      )}
    </section>
  )
}

function summarize(abilities: AgentAbilities, all: ReturnType<typeof useT>['abilities']) {
  return {
    context: { title: all.context.title, summary: summarizeContext(abilities.context), unavailable: abilityUnavailableReason(abilities, 'modelStep') },
    memory: { title: all.memory.title, summary: summarizeMemory(abilities.memory), unavailable: abilityUnavailableReason(abilities, 'agentStep') },
    helpers: { title: all.helpers.title, summary: summarizeHelpers(abilities.helpers, abilities.helperChoices), unavailable: abilityUnavailableReason(abilities, 'agentStep') },
    spending: { title: all.spending.title, summary: summarizeSpending(abilities.spending), unavailable: null },
  } satisfies Record<AbilityKey, { title: string; summary: string; unavailable: string | null }>
}
