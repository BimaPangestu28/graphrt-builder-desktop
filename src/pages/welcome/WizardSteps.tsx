import { useEffect, useRef, type ReactNode } from 'react'
import type { ProviderStatus } from '@/api/types'
import { Badge, Icon } from '@/components/ui'
import { localCliShortNames, localCliProviders } from '@/lib/settings'
import { getTrayAreaName } from '@/lib/platform'
import { apiKeyProviderOptions } from './welcomeSetup'
import type { WelcomeWizard } from './useWelcomeWizard'
import { WelcomeChoiceCard } from './WelcomeChoiceCard'
import { FoundLine, TechnicalDetails } from './WelcomeChoiceDetails'
import { accountTitle, describeAccount, installedTools, type WizardAnswers, type WizardApproach } from './welcomeWizard'

/**
 * Title and one-line explanation of a wizard step. The heading takes focus when the step
 * opens, so screen readers announce the new step and Tab starts from the top.
 */
export function StepHeader({ title, description }: { title: string; description?: ReactNode }) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [])
  return (
    <div className="flex flex-col gap-2">
      <h1 ref={headingRef} tabIndex={-1} className="m-0 text-[26px] font-semibold tracking-[-0.5px] outline-none sm:text-[28px]">
        {title}
      </h1>
      {description && <p className="m-0 text-[15px] leading-[1.6] text-body">{description}</p>}
    </div>
  )
}

const welcomePoints = [
  { icon: 'edit', text: 'Describe a routine task in your own words' },
  { icon: 'play', text: 'graphrt turns it into an agent you can test' },
  { icon: 'clock', text: 'Put it on a schedule; it runs right here on your computer' },
] as const

/** Step 1: what graphrt does, in one line, and how long setup takes. */
export function WelcomeStep() {
  return (
    <>
      <StepHeader title="Welcome to graphrt" description="graphrt builds AI agents that take routine work off your plate. Setup takes about a minute." />
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {welcomePoints.map((point) => (
          <li key={point.text} className="flex items-center gap-3 text-[15px]">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand-strong">
              <Icon name={point.icon} size={18} />
            </span>
            {point.text}
          </li>
        ))}
      </ul>
    </>
  )
}

function RecommendedBadge() {
  return <Badge tone="brand">Recommended</Badge>
}

/** "Found: your Claude account" for the "account I already have" card. */
function describeFoundAccounts(statuses: readonly ProviderStatus[] | null): ReactNode {
  if (!statuses) return <span className="text-muted">Looking on this computer…</span>
  const tools = installedTools(statuses)
  if (tools.length === 0) return <span className="text-muted">None found on this computer</span>
  const accountNames = tools.map(describeAccount)
  const shownNames = accountNames.length > 2 ? `${accountNames.slice(0, 2).join(', ')} and ${accountNames.length - 2} more` : accountNames.join(' and ')
  return <FoundLine text={`Found ${shownNames}`} />
}

function describeOllama(isRunning: boolean | null): ReactNode {
  if (isRunning === null) return <span className="text-muted">Looking on this computer…</span>
  if (isRunning) return <FoundLine text="Already running on this computer" />
  return <span className="text-muted">Needs the free Ollama app (we show you how)</span>
}

/** Versions and install state of everything detected, for the curious; closed by default. */
function DetectionDetails({ wizard }: { wizard: WelcomeWizard }) {
  const { statuses, isOllamaRunning } = wizard.detection
  return (
    <TechnicalDetails summary="What graphrt found on this computer">
      <p className="m-0">
        “An AI account I already have” runs the AI tool you are signed in to (a command-line app such as Claude Code or Codex). This is Experimental: usage counts
        against that tool’s own plan and limits.
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {localCliProviders.map((provider) => {
          const localCli = statuses?.find((status) => status.provider === provider)?.localCli
          const state = !localCli ? 'checking…' : localCli.installed ? `found${localCli.version ? ` · ${localCli.version}` : ''}` : 'not installed'
          return (
            <li key={provider} className="break-words">
              <span className="font-medium text-ink-2">{localCliShortNames[provider]}</span> — {state}
            </li>
          )
        })}
        <li>
          <span className="font-medium text-ink-2">Ollama</span> — {isOllamaRunning === null ? 'checking…' : isOllamaRunning ? 'running' : 'not running'}
        </li>
      </ul>
    </TechnicalDetails>
  )
}

/** Step 2: the one big decision, with the recommended answer already picked. */
export function ApproachStep({ wizard }: { wizard: WelcomeWizard }) {
  const { answers, detection, recommendedApproach } = wizard
  const hasTools = installedTools(detection.statuses).length > 0
  const cardProps = { groupName: 'welcome-approach', selectedValue: answers.approach, onSelect: wizard.setApproach }
  const badgeFor = (approach: WizardApproach) => (recommendedApproach === approach ? <RecommendedBadge /> : undefined)
  return (
    <>
      <StepHeader title="How should your agents think?" description="Agents need an AI to understand your instructions. Pick what suits you; you can change it any time in Connections." />
      <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
        <legend className="sr-only">How your agents think</legend>
        <WelcomeChoiceCard
          {...cardProps}
          value="existing-account"
          title="Use an AI account I already have"
          badges={badgeFor('existing-account')}
          isUnavailable={detection.statuses !== null && !hasTools}
          details={
            <>
              <span>Uses the AI app you are already signed in to on this computer, such as Claude or ChatGPT. Nothing new to buy.</span>
              {describeFoundAccounts(detection.statuses)}
            </>
          }
        />
        <WelcomeChoiceCard
          {...cardProps}
          value="company-key"
          title="Use my company’s API key"
          badges={badgeFor('company-key')}
          details={<span>Paste a key from OpenAI, Anthropic, Google or DeepSeek. Best when other people will use your agents.</span>}
        />
        <WelcomeChoiceCard
          {...cardProps}
          value="private-model"
          title="Free, private AI on this computer"
          badges={badgeFor('private-model')}
          details={
            <>
              <span>Runs on this computer with the free Ollama app, even offline. Nothing leaves your computer; answers are slower.</span>
              {describeOllama(detection.isOllamaRunning)}
            </>
          }
        />
        <WelcomeChoiceCard
          {...cardProps}
          value="later"
          isQuiet
          title="Decide later"
          badges={badgeFor('later')}
          details={<span>Look around first. graphrt asks again when you build your first agent.</span>}
        />
      </fieldset>
      <DetectionDetails wizard={wizard} />
    </>
  )
}

/** Step 4: keep running from the menu bar / system tray, explained plainly. */
export function BackgroundStep({ wizard }: { wizard: WelcomeWizard }) {
  const trayAreaName = getTrayAreaName()
  return (
    <>
      <StepHeader
        title="Keep agents working after you close the window?"
        description={`Scheduled agents can only run while graphrt is open. With this on, closing the window tucks graphrt into the ${trayAreaName} instead of quitting it.`}
      />
      <label className="flex cursor-pointer items-start gap-3 rounded-[14px] border border-line-strong p-4">
        <input
          type="checkbox"
          checked={wizard.keepRunningInBackground}
          onChange={(event) => wizard.setKeepRunningInBackground(event.target.checked)}
          className="mt-0.5 size-[18px] shrink-0 accent-brand"
        />
        <span className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">Keep agents running from the {trayAreaName}</span>
          <span className="text-[13px] leading-normal text-body">Recommended. Your agents run on time even when the window is closed. Open graphrt again from its icon in the {trayAreaName}.</span>
        </span>
      </label>
      <p className="m-0 text-[13px] text-muted">You can change this later in Settings.</p>
    </>
  )
}

/** Plain summary of the "thinking" answer for the last step. */
function describeThinking(answers: WizardAnswers): string {
  switch (answers.approach) {
    case 'existing-account':
      return answers.tool ? `${accountTitle(answers.tool)} (through ${localCliShortNames[answers.tool]})` : 'Your existing AI account'
    case 'company-key':
      return `Your company’s ${apiKeyProviderOptions.find((option) => option.provider === answers.apiKeyProvider)?.label} key`
    case 'private-model':
      return 'Free, private AI on this computer (Ollama)'
    default:
      return 'Not decided yet: graphrt asks when you build your first agent'
  }
}

/** Step 5: a short summary, the first next action, and the save error if any. */
export function DoneStep({ wizard }: { wizard: WelcomeWizard }) {
  const isDecidingLater = wizard.answers.approach === 'later'
  const summaryRows = [
    { label: 'Agents think with', value: describeThinking(wizard.answers) },
    { label: 'When the window closes', value: wizard.keepRunningInBackground ? `Agents keep running from the ${getTrayAreaName()}` : 'graphrt quits and agents stop' },
  ]
  return (
    <>
      <StepHeader
        title="You’re all set"
        description={isDecidingLater ? 'Take a look around. Browse templates and see what agents can do.' : 'Next, describe your first agent in plain words and graphrt builds it.'}
      />
      <dl className="m-0 flex flex-col gap-3 rounded-[14px] border border-line bg-subtle p-4">
        {summaryRows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <dt className="text-[12px] font-semibold text-muted">{row.label}</dt>
            <dd className="m-0 text-[15px]">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-[13px] text-muted">You can change any of this later in Connections and Settings.</p>
      {wizard.saveErrorMessage && (
        <p role="alert" className="m-0 leading-normal text-danger">
          {wizard.saveErrorMessage}
        </p>
      )}
    </>
  )
}
