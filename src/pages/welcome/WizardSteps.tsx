import { useEffect, useRef, type ReactNode } from 'react'
import type { ProviderStatus } from '@/api/types'
import { Badge, Icon, joinClassNames } from '@/components/ui'
import { localCliShortNames, localCliProviders } from '@/lib/settings'
import { getTrayAreaName } from '@/lib/platform'
import { apiKeyProviderOptions } from './welcomeSetup'
import type { WelcomeWizard } from './useWelcomeWizard'
import { choiceGridClassNames, WelcomeChoiceCard } from './WelcomeChoiceCard'
import { FoundLine, ProblemLine, TechnicalDetails } from './WelcomeChoiceDetails'
import { accountTitle, brokenTools, describeAccount, installedTools, type WizardAnswers, type WizardApproach } from './welcomeWizard'
import { messages, useT } from '@/i18n'

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
      {description && <p className="m-0 max-w-[720px] text-[15px] leading-[1.6] text-body">{description}</p>}
    </div>
  )
}

const welcomePointIcons = ['edit', 'play', 'clock'] as const

/** Step 1: what graphrt does, in one line, and how long setup takes. */
export function WelcomeStep() {
  const t = useT().welcome
  const welcomePoints = t.points.map((point, pointIndex) => ({ ...point, icon: welcomePointIcons[pointIndex] ?? 'edit' }))
  return (
    <>
      <StepHeader title={t.welcomeTitle} description={t.welcomeDescription} />
      <ul className={joinClassNames(choiceGridClassNames(welcomePoints.length), 'list-none')}>
        {welcomePoints.map((point) => (
          <li key={point.title} className="flex h-full flex-col gap-2 rounded-[14px] border border-line p-4">
            <span className="flex items-center gap-3">
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand-strong">
                <Icon name={point.icon} size={18} />
              </span>
              <span className="truncate text-[15px] font-semibold">{point.title}</span>
            </span>
            <span className="text-[13px] leading-normal text-body">{point.text}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

function RecommendedBadge() {
  return <Badge tone="brand">{useT().welcome.recommended}</Badge>
}

/** "Found: your Claude account" for the "account I already have" card. */
function describeFoundAccounts(statuses: readonly ProviderStatus[] | null): ReactNode {
  const { welcome: t, common } = messages()
  if (!statuses) return <span className="text-muted">{t.lookingOnComputer}</span>
  const tools = installedTools(statuses)
  if (tools.length === 0) {
    const broken = brokenTools(statuses)
    if (broken.length > 0) return <ProblemLine text={t.foundButDoesNotStart(common.joinAnd(broken.map((provider) => localCliShortNames[provider])))} />
    return <span className="text-muted">{t.noneFound}</span>
  }
  const accountNames = tools.map(describeAccount)
  const shownNames = accountNames.length > 2 ? t.andMore(accountNames.slice(0, 2).join(', '), accountNames.length - 2) : common.joinAnd(accountNames)
  return <FoundLine text={t.found(shownNames)} />
}

function describeOllama(isRunning: boolean | null): ReactNode {
  const t = messages().welcome
  if (isRunning === null) return <span className="text-muted">{t.lookingOnComputer}</span>
  if (isRunning) return <FoundLine text={t.ollamaRunning} />
  return <span className="text-muted">{t.ollamaNeeded}</span>
}

/** Versions and install state of everything detected, for the curious; closed by default. */
function DetectionDetails({ wizard }: { wizard: WelcomeWizard }) {
  const t = useT().welcome
  const { statuses, isOllamaRunning } = wizard.detection
  return (
    <TechnicalDetails summary={t.detectionSummary}>
      <p className="m-0">{t.detectionNote}</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {localCliProviders.map((provider) => {
          const localCli = statuses?.find((status) => status.provider === provider)?.localCli
          const state = !localCli
            ? t.stateChecking
            : !localCli.installed
              ? t.stateNotInstalled
              : localCli.problem
                ? t.stateBroken(localCli.problem)
                : t.stateFound(localCli.version ?? null)
          return (
            <li key={provider} className="break-words">
              <span className="font-medium text-ink-2">{localCliShortNames[provider]}</span> — {state}
            </li>
          )
        })}
        <li>
          <span className="font-medium text-ink-2">Ollama</span> — {isOllamaRunning === null ? t.stateChecking : isOllamaRunning ? t.stateRunning : t.stateNotRunning}
        </li>
      </ul>
    </TechnicalDetails>
  )
}

/** Step 2: the one big decision, with the recommended answer already picked. */
export function ApproachStep({ wizard }: { wizard: WelcomeWizard }) {
  const t = useT().welcome
  const { answers, detection, recommendedApproach } = wizard
  const hasTools = installedTools(detection.statuses).length > 0
  const cardProps = { groupName: 'welcome-approach', selectedValue: answers.approach, onSelect: wizard.setApproach }
  const badgeFor = (approach: WizardApproach) => (recommendedApproach === approach ? <RecommendedBadge /> : undefined)
  return (
    <>
      <StepHeader title={t.approachTitle} description={t.approachDescription} />
      <fieldset className={choiceGridClassNames(4)}>
        <legend className="sr-only">{t.approachLegend}</legend>
        <WelcomeChoiceCard
          {...cardProps}
          value="existing-account"
          title={t.existingAccountTitle}
          badges={badgeFor('existing-account')}
          isUnavailable={detection.statuses !== null && !hasTools}
          details={
            <>
              <span>{t.existingAccountText}</span>
              {describeFoundAccounts(detection.statuses)}
            </>
          }
        />
        <WelcomeChoiceCard
          {...cardProps}
          value="company-key"
          title={t.companyKeyTitle}
          badges={badgeFor('company-key')}
          details={<span>{t.companyKeyText}</span>}
        />
        <WelcomeChoiceCard
          {...cardProps}
          value="private-model"
          title={t.privateModelTitle}
          badges={badgeFor('private-model')}
          details={
            <>
              <span>{t.privateModelText}</span>
              {describeOllama(detection.isOllamaRunning)}
            </>
          }
        />
        <WelcomeChoiceCard
          {...cardProps}
          value="later"
          isQuiet
          title={t.laterTitle}
          badges={badgeFor('later')}
          details={<span>{t.laterText}</span>}
        />
      </fieldset>
      <DetectionDetails wizard={wizard} />
    </>
  )
}

/** Step 4: keep running from the menu bar / system tray, explained plainly. */
export function BackgroundStep({ wizard }: { wizard: WelcomeWizard }) {
  const t = useT().welcome
  const trayAreaName = getTrayAreaName()
  return (
    <>
      <StepHeader title={t.backgroundTitle} description={t.backgroundDescription(trayAreaName)} />
      <label className="flex max-w-[720px] cursor-pointer items-start gap-3 rounded-[14px] border border-line-strong p-4">
        <input
          type="checkbox"
          checked={wizard.keepRunningInBackground}
          onChange={(event) => wizard.setKeepRunningInBackground(event.target.checked)}
          className="mt-0.5 size-[18px] shrink-0 accent-brand"
        />
        <span className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">{t.backgroundToggle(trayAreaName)}</span>
          <span className="text-[13px] leading-normal text-body">{t.backgroundToggleHint(trayAreaName)}</span>
        </span>
      </label>
      <p className="m-0 text-[13px] text-muted">{t.changeLaterInSettings}</p>
    </>
  )
}

/** Plain summary of the "thinking" answer for the last step. */
function describeThinking(answers: WizardAnswers): string {
  const t = messages().welcome
  switch (answers.approach) {
    case 'existing-account':
      return answers.tool ? t.thinkingThrough(accountTitle(answers.tool), localCliShortNames[answers.tool]) : t.thinkingExistingAccount
    case 'company-key':
      return t.thinkingCompanyKey(apiKeyProviderOptions.find((option) => option.provider === answers.apiKeyProvider)?.label ?? answers.apiKeyProvider)
    case 'private-model':
      return t.thinkingPrivate
    default:
      return t.thinkingLater
  }
}

/** Step 5: a short summary, the first next action, and the save error if any. */
export function DoneStep({ wizard }: { wizard: WelcomeWizard }) {
  const t = useT().welcome
  const isDecidingLater = wizard.answers.approach === 'later'
  const summaryRows = [
    { label: t.summaryThinkWith, value: describeThinking(wizard.answers) },
    { label: t.summaryWindowCloses, value: wizard.keepRunningInBackground ? t.summaryKeepRunning(getTrayAreaName()) : t.summaryQuits },
  ]
  return (
    <>
      <StepHeader title={t.doneTitle} description={isDecidingLater ? t.doneLaterDescription : t.doneDescription} />
      <dl className={joinClassNames(choiceGridClassNames(summaryRows.length), 'rounded-[14px] border border-line bg-subtle p-4')}>
        {summaryRows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <dt className="text-[12px] font-semibold text-muted">{row.label}</dt>
            <dd className="m-0 text-[15px]">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-[13px] text-muted">{t.changeLaterEverywhere}</p>
      {wizard.saveErrorMessage && (
        <p role="alert" className="m-0 leading-normal text-danger">
          {wizard.saveErrorMessage}
        </p>
      )}
    </>
  )
}
