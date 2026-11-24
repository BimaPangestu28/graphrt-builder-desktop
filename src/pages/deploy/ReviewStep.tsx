import { useState, type ReactNode } from 'react'
import { installGraphrtCli, openDeployLink } from '@/api/deploy'
import { deployProviderNames, type CliInfo, type DeployMode, type DeployReview, type ServerArea } from '@/api/deployTypes'
import { Badge, Button, Icon, joinClassNames } from '@/components/ui'
import { DevelopersDetails } from './DeployDialog'
import { deployModeLabels, describeCliNeed, plainErrorMessage, serverAreaLabels } from './deployDisplay'

interface ReviewStepProps {
  agentName: string
  review: DeployReview
  isUpdate: boolean
  onCliChanged: (cli: CliInfo) => void
  onBack: () => void
  onConfirm: (choice: { mode: DeployMode; area: ServerArea }) => void
}

function ReviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-4">
      <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function CreatedItem({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon name="check" size={15} className="mt-0.5 shrink-0 text-ok" />
      <span className="flex flex-col">
        <span className="font-medium">{title}</span>
        <span className="text-[13px] text-body">{detail}</span>
      </span>
    </li>
  )
}

/** First time only: the graphrt tools, downloaded with the person's OK (or "not available yet"). */
function CliDownload({ cli, onCliChanged }: { cli: CliInfo; onCliChanged: (cli: CliInfo) => void }) {
  const [isInstalling, setIsInstalling] = useState(cli.status === 'installing')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  async function install() {
    setIsInstalling(true)
    setErrorMessage(null)
    try {
      onCliChanged(await installGraphrtCli())
    } catch (error) {
      setErrorMessage(plainErrorMessage(error))
    } finally {
      setIsInstalling(false)
    }
  }
  if (cli.status === 'installed') return null
  return (
    <div className={joinClassNames('flex flex-wrap items-center gap-3 rounded-[12px] border px-4 py-3', cli.status === 'not_available' ? 'border-line bg-subtle' : 'border-brand-line bg-brand-tint')}>
      <span className="min-w-0 flex-[1_1_280px] text-[13px] leading-normal text-ink-2">{describeCliNeed(cli)}</span>
      {cli.status !== 'not_available' && (
        <Button size="sm" variant="secondary" onClick={() => void install()} disabled={isInstalling}>
          {isInstalling ? 'Downloading…' : 'Allow download'}
        </Button>
      )}
      {errorMessage && (
        <p role="alert" className="m-0 w-full text-[13px] text-danger">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

const areas: ServerArea[] = ['asia', 'europe', 'us']
const modes: DeployMode[] = ['always_on', 'scale_to_zero']

/**
 * Review: what will be created, how it runs (Always ready / Saves money), where (Asia / Europe /
 * US), which keys are copied (by friendly name), the cost note and the billing checkbox.
 * "Put it online" stays off until the box is ticked, the tools are there and the provider can deploy.
 */
export function ReviewStep({ agentName, review, isUpdate, onCliChanged, onBack, onConfirm }: ReviewStepProps) {
  const [mode, setMode] = useState<DeployMode>(review.mode)
  const [area, setArea] = useState<ServerArea>(review.area)
  const [acceptsBilling, setAcceptsBilling] = useState(isUpdate)
  const providerName = deployProviderNames[review.provider]
  const isFly = review.provider === 'fly'
  const blockedReason = !review.canDeploy
    ? `Putting agents online with ${providerName} is coming soon. Your account is saved for when it's ready.`
    : !review.providerConnected
      ? `Connect ${providerName} first.`
      : null
  const canConfirm = review.canDeploy && review.providerConnected && review.cli.status === 'installed' && acceptsBilling

  return (
    <section aria-label="Review" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[20px] font-semibold tracking-[-0.2px]">Review</h2>
        <span className="text-body">
          {agentName} on {providerName}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-3">
        <ReviewSection title="What will be created">
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            <CreatedItem title={`An online copy of ${agentName}`} detail={`On ${providerName}, in your account`} />
            <CreatedItem title="Its web address" detail={review.expectedAddress} />
            <CreatedItem title="A small storage space" detail="Keeps its history and conversations waiting for you" />
          </ul>
        </ReviewSection>
        <ReviewSection title="How it runs">
          <div role="radiogroup" aria-label="How it runs" className="flex flex-col gap-2">
            {modes.map((option) => (
              <label key={option} className={joinClassNames('flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5', mode === option ? 'border-ink' : 'border-line')}>
                <input type="radio" name="deploy-mode" checked={mode === option} onChange={() => setMode(option)} className="mt-1 accent-[var(--color-ink)]" />
                <span className="flex flex-col">
                  <span className="font-medium">{deployModeLabels[option].title}</span>
                  <span className="text-[13px] text-body">{deployModeLabels[option].detail}</span>
                </span>
              </label>
            ))}
          </div>
          <DevelopersDetails>
            <label className="flex items-start gap-2 opacity-60">
              <input type="checkbox" disabled className="mt-0.5" />
              <span>
                Use a wake-up service <Badge>Preview</Badge> — keeps conversations safe while the agent sleeps. Needs a separate always-on service; not available yet.
              </span>
            </label>
          </DevelopersDetails>
        </ReviewSection>
        <ReviewSection title="Server location">
          <label className="flex flex-col gap-1.5 text-[13px] text-body">
            Pick where most of your customers are
            <select aria-label="Server location" value={area} onChange={(event) => setArea(event.target.value as ServerArea)} className="h-10 rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink">
              {areas.map((option) => (
                <option key={option} value={option}>
                  {serverAreaLabels[option]}
                </option>
              ))}
            </select>
          </label>
        </ReviewSection>
        <ReviewSection title="Keys that will be copied">
          {review.keys.length === 0 ? (
            <span className="text-[13px] text-body">None: this agent uses no keys.</span>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {review.keys.map((key) => (
                <li key={key.envName} className="flex items-start justify-between gap-3">
                  <span className="flex flex-col">
                    <span className="font-medium">{key.friendlyName}</span>
                    <span className="text-[13px] text-body">{key.purpose}</span>
                  </span>
                  <Badge tone={key.isSaved ? 'ok' : 'amber'}>{key.isSaved ? 'Copied safely' : 'Missing'}</Badge>
                </li>
              ))}
            </ul>
          )}
          <span className="text-[12px] text-muted">They go straight to {providerName}'s safe storage. Never shown or saved anywhere else.</span>
        </ReviewSection>
      </div>
      <ReviewSection title="Monthly cost">
        <span className="text-[13px] leading-normal text-body">
          Billed by {providerName} to your account — see their pricing. graphrt doesn't charge for this.{' '}
          {isFly && (
            <button type="button" onClick={() => void openDeployLink('fly_pricing')} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-brand hover:underline">
              Fly.io pricing
            </button>
          )}
        </span>
      </ReviewSection>
      <CliDownload cli={review.cli} onCliChanged={onCliChanged} />
      {blockedReason && (
        <p role="status" className="m-0 rounded-[12px] border border-line bg-subtle px-4 py-3 text-[13px] text-ink-2">
          {blockedReason}
        </p>
      )}
      <label className="flex items-center gap-2.5">
        <input type="checkbox" checked={acceptsBilling} onChange={(event) => setAcceptsBilling(event.target.checked)} className="size-4 accent-[var(--color-ink)]" />
        <span>I understand {providerName} bills me for this</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onConfirm({ mode, area })} disabled={!canConfirm}>
          {!review.canDeploy ? 'Coming soon' : isUpdate ? 'Update online version' : 'Put it online'}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
      <DevelopersDetails>
        <span>
          {isFly ? 'Fly app' : 'Deployment'} <code>{review.deploymentName}</code> · region <code>{{ asia: 'sin', europe: 'fra', us: 'iad' }[area]}</code> ·{' '}
          {mode === 'scale_to_zero' ? 'autostop, min 0 machines' : 'min 1 machine'} · storage volume for runs · secrets{' '}
          {review.keys.map((key) => key.envName).join(', ') || 'none'}, plus a new <code>GRAPHRT_API_KEY</code>. Runs <code>graphrt deploy --target fly --direct</code>; secrets go to
          the tool as environment variables only.
        </span>
      </DevelopersDetails>
    </section>
  )
}
