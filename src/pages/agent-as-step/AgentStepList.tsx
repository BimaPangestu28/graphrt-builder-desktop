import { joinClassNames } from '@/components/ui'
import { stepsAfterInsert, stepsBeforeInsert, type LoopBodyStep, type StepCatalogItem } from '@/data/agentAsStep'

const monospaceChipClassNames = 'rounded-md bg-surface px-2 py-[3px] font-mono'

function AgentLogoTile() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink">
      <svg width="16" height="16" viewBox="0 0 28 28" aria-hidden="true">
        <path d="M20.5 10A7.5 7.5 0 1 0 21.5 15" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
        <circle cx="14" cy="14" r="3" fill="#2DD4BF" />
      </svg>
    </span>
  )
}

function describeInsertedStep(item: StepCatalogItem): { subtitle: string; badge: string } {
  if (item.category === 'myAgents') return { subtitle: `Runs your agent ${item.name}${item.version ? ` · v${item.version}` : ''}`, badge: 'Agent' }
  if (item.category === 'plugins') return { subtitle: `Runs the plugin ${item.name}`, badge: 'Plugin' }
  return { subtitle: `Built-in step · ${item.name}`, badge: 'Step' }
}

interface InsertedStepCardProps {
  item: StepCatalogItem
  isVersionPinned: boolean
  onVersionPinnedChange: (isPinned: boolean) => void
}

/** The newly inserted step, highlighted in teal, with what it sends and gets back. */
function InsertedStepCard({ item, isVersionPinned, onVersionPinnedChange }: InsertedStepCardProps) {
  const { subtitle, badge } = describeInsertedStep(item)
  return (
    <li className="mt-2 mr-2 mb-2 ml-11 flex flex-col gap-3 rounded-xl border border-brand-line-2 bg-brand-tint p-4">
      <div className="flex items-center gap-3">
        <AgentLogoTile />
        <div className="flex flex-auto flex-col gap-0.5">
          <span className="font-semibold">{item.stepTitle}</span>
          <span className="text-[13px] text-body">{subtitle}</span>
        </div>
        <span className="rounded-full border border-brand-line-2 bg-surface px-2 py-[3px] text-[12px] font-semibold text-brand-strong">{badge}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {item.sends.length > 0 && <span className="text-ink-2">Sends</span>}
        {item.sends.map((field) => (
          <span key={`sends-${field}`} className={monospaceChipClassNames}>
            {field}
          </span>
        ))}
        {item.getsBack.length > 0 && <span className={joinClassNames('text-ink-2', item.sends.length > 0 && 'ml-2')}>Gets back</span>}
        {item.getsBack.map((field) => (
          <span key={`gets-${field}`} className={monospaceChipClassNames}>
            {field}
          </span>
        ))}
      </div>
      {item.version !== undefined && (
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={isVersionPinned} onChange={(event) => onVersionPinnedChange(event.target.checked)} className="size-4 accent-brand" />
          Stay on v{item.version}, ask me before using a newer version
        </label>
      )}
    </li>
  )
}

function LoopBodyStepRow({ step }: { step: LoopBodyStep }) {
  return (
    <li className="flex items-center gap-3.5 border-t border-chip py-3.5 pr-4 pl-[60px]">
      <span className="flex-auto font-medium">{step.title}</span>
      {step.tag?.tone === 'muted' && <span className="text-[12px] text-muted">{step.tag.label}</span>}
      {step.tag?.tone === 'amber' && <span className="rounded-full bg-amber-soft px-2 py-[3px] text-[12px] font-medium text-amber-strong">{step.tag.label}</span>}
    </li>
  )
}

interface AgentStepListProps {
  insertedItem: StepCatalogItem | undefined
  isVersionPinned: boolean
  onVersionPinnedChange: (isPinned: boolean) => void
}

/** Left side of screen 12: the agent's steps with the inserted step inside the "For each place" loop. */
export function AgentStepList({ insertedItem, isVersionPinned, onVersionPinnedChange }: AgentStepListProps) {
  return (
    <section aria-label="Steps" className="box-border flex min-w-0 flex-[2_1_480px] flex-col gap-5 px-8 py-7">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.3px]">Maps leads to WhatsApp</h1>
        <span className="text-body">Adding a step after Search Google Maps</span>
      </div>
      <ol className="m-0 list-none rounded-[14px] border border-line p-0">
        {stepsBeforeInsert.map((stepTitle, stepIndex) => (
          <li key={stepTitle} className="flex items-center gap-3.5 border-b border-chip px-4 py-3.5">
            <span className="w-[22px] text-center text-[12px] font-semibold text-muted">{stepIndex + 1}</span>
            <span className="flex-auto font-medium">{stepTitle}</span>
          </li>
        ))}
        {insertedItem && <InsertedStepCard item={insertedItem} isVersionPinned={isVersionPinned} onVersionPinnedChange={onVersionPinnedChange} />}
        {stepsAfterInsert.map((step) => (
          <LoopBodyStepRow key={step.title} step={step} />
        ))}
      </ol>
    </section>
  )
}
