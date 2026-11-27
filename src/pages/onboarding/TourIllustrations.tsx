import type { ReactNode } from 'react'
import { getCredentialStoreName, getCredentialStoreShortName } from '@/lib/platform'
import { Icon, LogoMark, StatusDot, joinClassNames } from '@/components/ui'
import type { TourStepId } from './tourSteps'
import { messages } from '@/i18n'

/**
 * Small decorative pictures for the onboarding tour, drawn with the app's own tokens and
 * primitives (no images). They are hidden from screen readers: the step text says it all.
 */

const chipClassNames = 'rounded-full border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2'

function IllustrationFrame({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true" className="flex h-[132px] items-center justify-center rounded-[14px] border border-line bg-subtle px-4">
      {children}
    </div>
  )
}

function MiniCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={joinClassNames('flex flex-col gap-1.5 rounded-[10px] border border-line-strong bg-surface p-2.5 text-[12px]', className)}>{children}</div>
}

function HowItWorksIllustration() {
  const stages = [messages().misc.describe, messages().misc.steps, messages().misc.test, messages().misc.schedule]
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {stages.map((stage, index) => (
        <span key={stage} className="flex items-center gap-1.5">
          <span className={joinClassNames(chipClassNames, index === 0 && 'border-brand-line bg-brand-soft text-brand-strong')}>{stage}</span>
          {index < stages.length - 1 && <Icon name="arrowRight" size={14} className="text-faint" />}
        </span>
      ))}
    </div>
  )
}

function BuildWithChatIllustration() {
  return (
    <div className="flex w-full max-w-[320px] flex-col gap-1.5 text-[12px]">
      <span className="self-end rounded-[10px] bg-ink px-2.5 py-1.5 text-inverse">{messages().misc.alsoSendMeASummary}</span>
      <span className="flex items-center gap-1.5 self-start rounded-[10px] border border-line-strong bg-surface px-2.5 py-1.5 text-ink-2">
        <LogoMark size={14} />
        {messages().misc.addedStep6SendSummary}
      </span>
      <span className={joinClassNames(chipClassNames, 'self-start')}>{messages().misc.version3Saved}</span>
    </div>
  )
}

function TestRunIllustration() {
  return (
    <div className="grid w-full max-w-[340px] grid-cols-2 gap-2">
      <MiniCard className="border-2 border-amber-line">
        <span className="font-semibold">{messages().misc.askMeBeforeSending}</span>
        <span className="flex gap-1">
          <span className="rounded-md bg-ok px-1.5 py-0.5 text-[11px] font-semibold text-inverse">{messages().misc.approve}</span>
          <span className="rounded-md border border-line-strong px-1.5 py-0.5 text-[11px]">{messages().misc.skip}</span>
        </span>
      </MiniCard>
      <MiniCard>
        <span className="flex items-center gap-1 font-semibold">
          <StatusDot tone="ok" /> {messages().misc.liveView}
        </span>
        <span className="h-2 w-4/5 rounded bg-chip" />
        <span className="h-2 w-3/5 rounded bg-chip" />
      </MiniCard>
    </div>
  )
}

function PluginsIllustration() {
  return (
    <div className="flex w-full max-w-[340px] flex-col gap-1.5">
      {[messages().misc.googleMapsScraper, messages().misc.whatsappWeb].map((pluginName, index) => (
        <MiniCard key={pluginName} className="flex-row items-center justify-between">
          <span className="font-semibold">{pluginName}</span>
          <span className={joinClassNames(chipClassNames, index === 0 ? 'border-ok-soft bg-ok-tint text-ok-strong' : '')}>{index === 0 ? messages().misc.trusted : messages().misc.scanQrCode}</span>
        </MiniCard>
      ))}
    </div>
  )
}

function SecretsIllustration() {
  return (
    <MiniCard className="w-full max-w-[300px]">
      <span className="font-mono font-semibold">{messages().misc.crmApiToken}</span>
      <span className="flex items-center justify-between text-muted">
        <span className="tracking-[2px]">••••••••••</span>
        <span>{getCredentialStoreName()}</span>
      </span>
    </MiniCard>
  )
}

function RunsScheduleInboxIllustration() {
  const rows = [
    { label: messages().misc.mapsLeadsToWhatsapp, meta: messages().misc.succeeded, tone: 'ok' as const },
    { label: messages().misc.morningDigest, meta: messages().misc.next0800, tone: 'brand' as const },
    { label: messages().misc.cateringAssistant, meta: messages().misc.waitingForYou, tone: 'amber' as const },
  ]
  return (
    <div className="flex w-full max-w-[340px] flex-col gap-1">
      {rows.map((row) => (
        <span key={row.label} className="flex items-center justify-between rounded-lg bg-surface px-2.5 py-1.5 text-[12px]">
          <span className="flex items-center gap-1.5 font-medium">
            <StatusDot tone={row.tone} />
            {row.label}
          </span>
          <span className="text-muted">{row.meta}</span>
        </span>
      ))}
    </div>
  )
}

function KnowledgeIllustration() {
  return (
    <div className="flex items-center gap-2">
      {['menu.pdf', 'prices.xlsx', 'example.com/faq'].map((sourceName) => (
        <MiniCard key={sourceName} className="items-center">
          <Icon name="file" size={18} className="text-brand" />
          <span className="text-[11px] text-ink-2">{sourceName}</span>
        </MiniCard>
      ))}
    </div>
  )
}

function PrivacyIllustration() {
  return (
    <div className="flex items-center gap-3">
      <svg width="76" height="56" viewBox="0 0 76 56" fill="none" className="text-ink-2">
        <rect x="8" y="4" width="60" height="38" rx="5" stroke="currentColor" strokeWidth="2" />
        <path d="M2 48h72l-4 5H6z" fill="currentColor" opacity="0.25" />
        <rect x="30" y="14" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M34 14v-3a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
      </svg>
      <span className="flex flex-col gap-1">
        <span className={chipClassNames}>{messages().misc.agentsAndRuns}</span>
        <span className={chipClassNames}>{messages().misc.keysIn}{' '}{getCredentialStoreShortName()}</span>
      </span>
    </div>
  )
}

const illustrationByStepId: Record<TourStepId, () => ReactNode> = {
  'how-it-works': HowItWorksIllustration,
  'build-with-chat': BuildWithChatIllustration,
  'test-runs': TestRunIllustration,
  plugins: PluginsIllustration,
  secrets: SecretsIllustration,
  'runs-schedule-inbox': RunsScheduleInboxIllustration,
  knowledge: KnowledgeIllustration,
  privacy: PrivacyIllustration,
}

/** The picture for one tour step. */
export function TourIllustration({ stepId }: { stepId: TourStepId }) {
  const StepIllustration = illustrationByStepId[stepId]
  return (
    <IllustrationFrame>
      <StepIllustration />
    </IllustrationFrame>
  )
}
