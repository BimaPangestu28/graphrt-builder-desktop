import { useEffect, useId, useRef, useState } from 'react'
import { getAgentAbilities, setAgentAbility, setAgentSpendingLimit } from '@/api/abilities'
import type { AgentAbilities } from '@/api/abilitiesTypes'
import { isBackendErrorWithCode } from '@/api/client'
import { Card, buttonClassNames, joinClassNames } from '@/components/ui'
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
  /** Another ability's editor is open: Change waits until it is saved or cancelled. */
  isBlocked: boolean
  onOpen: () => void
  buttonRef: (button: HTMLButtonElement | null) => void
}

/** One ability at a glance: its name, what it does now (or why it cannot), and Change. */
function AbilityCard({ title, summary, unavailableReason, isOpen, isBlocked, onOpen, buttonRef }: AbilityCardProps) {
  const t = useT().abilities.section
  const reasonId = useId()
  const isDisabled = unavailableReason !== null || isBlocked
  return (
    <Card className={joinClassNames('flex h-full min-w-0 flex-col gap-1.5 p-3.5', isOpen && 'border-ink')}>
      <span title={title} className="line-clamp-2 text-[14px] leading-[19px] font-semibold text-ink">
        {title}
      </span>
      <div className="mt-auto flex min-w-0 items-center gap-3">
        <span id={reasonId} title={unavailableReason ?? summary} className="line-clamp-2 min-w-0 flex-auto text-[12.5px] leading-[17px] text-muted">
          {unavailableReason ?? summary}
        </span>
        <button
          type="button"
          ref={buttonRef}
          onClick={() => !isDisabled && onOpen()}
          aria-disabled={isDisabled}
          aria-describedby={unavailableReason ? reasonId : undefined}
          title={isBlocked ? t.closeOtherFirst : undefined}
          aria-expanded={isOpen}
          aria-label={`${t.change}: ${title}`}
          className={buttonClassNames('secondary', 'sm', joinClassNames('shrink-0', isDisabled && 'cursor-not-allowed opacity-50'))}
        >
          {t.change}
        </button>
      </div>
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
  const changeButtons = useRef(new Map<AbilityKey, HTMLButtonElement>())
  const lastOpened = useRef<AbilityKey | null>(null)
  const abilities = state.data

  // Focus follows the editor: into it when it opens, back to its Change button when it closes.
  useEffect(() => {
    if (openAbility === null && lastOpened.current) changeButtons.current.get(lastOpened.current)?.focus()
  }, [openAbility])

  function open(key: AbilityKey) {
    setSaveError(null)
    setSavedNotice(null)
    lastOpened.current = key
    setOpenAbility((current) => (current === key ? null : key))
  }

  const save: SaveAbilities = async (changes) => {
    setIsSaving(true)
    setSaveError(null)
    let savedCount = 0
    try {
      if ('spending' in changes) {
        await setAgentSpendingLimit(agentId, changes.spending)
        setSavedNotice(t.savedLimit)
      } else {
        for (const change of changes) {
          await setAgentAbility(agentId, change)
          savedCount += 1
        }
        setSavedNotice(t.saved)
        onSaved?.()
      }
      setOpenAbility(null)
      await state.reload()
      return true
    } catch (error) {
      const reason = isBackendErrorWithCode(error, 'builder_busy') ? t.builderBusy : t.couldNotSave(describeError(error))
      // A change before the failing one saved a version: say so, and show what is saved now.
      setSaveError(savedCount > 0 ? `${t.partlySaved} ${reason}` : reason)
      if (savedCount > 0) onSaved?.()
      await state.reload()
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const summaries = abilities ? summarize(abilities, all) : null
  const editorProps = abilities ? { abilities, isSaving, error: saveError, onCancel: () => setOpenAbility(null), onSave: save } : null
  const notices = abilities ? [abilities.spendingUnreadable ? t.spendingUnreadable : null, abilities.stepsDiffer ? t.stepsDiffer : null].filter((notice): notice is string => notice !== null) : []

  return (
    <section aria-labelledby={headingId} className="@container flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 id={headingId} className="m-0 text-[15px] font-semibold text-ink">
          {t.title}
        </h3>
        <p className="m-0 text-[13px] leading-normal text-body">{t.subtitle}</p>
      </div>
      {state.error && !abilities && <p className="m-0 text-[13px] text-danger">{t.couldNotLoad(describeError(state.error))}</p>}
      {!abilities && !state.error && (
        <p role="status" className="m-0 text-[13px] text-muted">
          {t.loading}
        </p>
      )}
      {notices.map((notice) => (
        <p key={notice} className="m-0 rounded-[10px] border border-amber-line-2 bg-amber-tint px-3 py-2 text-[12.5px] leading-[18px] text-amber-deep">
          {notice}
        </p>
      ))}
      {abilities && summaries && (
        <ul className="m-0 grid min-w-0 list-none grid-cols-1 gap-2.5 p-0 @xl:grid-cols-2">
          {abilityKeys.map((key) => (
            <li key={key} className="min-w-0">
              <AbilityCard
                title={summaries[key].title}
                summary={summaries[key].summary}
                unavailableReason={summaries[key].unavailable}
                isOpen={openAbility === key}
                isBlocked={openAbility !== null && openAbility !== key}
                onOpen={() => open(key)}
                buttonRef={(button) => {
                  if (button) changeButtons.current.set(key, button)
                  else changeButtons.current.delete(key)
                }}
              />
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
