import type { FormEvent } from 'react'
import { Button, Icon, LogoMark } from '@/components/ui'
import { ConnectStep } from './welcome/ConnectStep'
import { useWelcomeWizard, type WelcomeWizard } from './welcome/useWelcomeWizard'
import { WizardProgress } from './welcome/WizardProgress'
import { ApproachStep, BackgroundStep, DoneStep, WelcomeStep } from './welcome/WizardSteps'
import { LanguageToggle } from '@/components/LanguageToggle'
import { messages, useT } from '@/i18n'

/** The current step's content. Keyed by step so each step mounts fresh (and focuses its heading). */
function CurrentStep({ wizard }: { wizard: WelcomeWizard }) {
  switch (wizard.stepId) {
    case 'welcome':
      return <WelcomeStep />
    case 'approach':
      return <ApproachStep wizard={wizard} />
    case 'setup':
      return <ConnectStep wizard={wizard} />
    case 'background':
      return <BackgroundStep wizard={wizard} />
    case 'done':
      return <DoneStep wizard={wizard} />
  }
}

/** The primary button's text on each step. */
function primaryLabel(wizard: WelcomeWizard): string {
  const t = messages().welcome
  if (wizard.stepId === 'welcome') return t.getStarted
  if (wizard.stepId !== 'done') return t.next
  if (wizard.isSaving) return t.saving
  return wizard.answers.approach === 'later' ? t.exploreApp : t.buildFirstAgent
}

/**
 * Screen 01 · Welcome, the first launch, as a step-by-step wizard for people who are not
 * developers: Welcome → How should your agents think? (an AI account already on this
 * computer, a company API key, free private AI with Ollama, or decide later; the
 * recommended one is preselected from what was detected) → Connect (only the picked
 * option's setup; skipped for "Decide later") → Background (keep running from the menu
 * bar / tray) → Done. Developer details (tool names, versions, Experimental notes) sit in
 * closed "details" disclosures. Finish saves with `saveWelcomeSetup` exactly as the old
 * single page did, remembering the choice (so `/` stops showing Welcome), then opens the
 * New agent screen, or Home after "Decide later".
 */
export function WelcomePage() {
  const t = useT().welcome
  const wizard = useWelcomeWizard()
  const isFirstStep = wizard.stepId === 'welcome'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (wizard.stepId === 'done') void wizard.finish()
    else wizard.goNext()
  }

  return (
    <div className="relative box-border flex min-h-screen w-full flex-col items-center justify-center gap-8 bg-canvas px-4 py-12 text-[14px] text-ink sm:px-6">
      {isFirstStep && <LanguageToggle className="absolute top-4 right-4 sm:top-6 sm:right-6" />}
      <div className="flex items-center gap-3">
        <LogoMark size={40} />
        <span className="text-[26px] font-bold tracking-[-0.5px]">{t.brand}</span>
      </div>

      <form onSubmit={submit} aria-label={t.formLabel} className="box-border flex w-full max-w-[1040px] flex-col gap-7 rounded-[20px] border border-line bg-surface p-6 sm:p-10">
        <WizardProgress steps={wizard.steps} currentStepId={wizard.stepId} />

        <CurrentStep key={wizard.stepId} wizard={wizard} />

        <div className="flex items-center justify-between gap-3 border-t border-line pt-6">
          {isFirstStep ? (
            <span />
          ) : (
            <Button variant="ghost" size="lg" onClick={wizard.goBack} disabled={wizard.isSaving}>
              <Icon name="arrowLeft" size={16} />
              {t.back}
            </Button>
          )}
          <Button type="submit" size="lg" disabled={!wizard.canGoNext}>
            {primaryLabel(wizard)}
            {wizard.stepId !== 'done' && <Icon name="arrowRight" size={16} />}
          </Button>
        </div>
      </form>
    </div>
  )
}
