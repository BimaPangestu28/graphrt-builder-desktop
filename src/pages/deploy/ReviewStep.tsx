import { useCallback, useState, type ReactNode } from 'react'
import { installGraphrtCli, openDeployLink, openGoogleCloudPage } from '@/api/deploy'
import { deployProviderNames, noOnlineFeatures, type CliInfo, type CloudPlace, type DeployMode, type DeployReview, type OnlineFeatures, type ServerArea } from '@/api/deployTypes'
import { Badge, Button, Icon, joinClassNames } from '@/components/ui'
import { DevelopersDetails } from './DeployDialog'
import { deployModeLabels, describeCliNeed, plainErrorMessage, serverAreaLabels } from './deployDisplay'
import type { FeaturesAvailability } from './onlineFeatures'
import { AwsRegionPicker } from './AwsRegionPicker'
import { GoogleCloudPlacePicker } from './GoogleCloudPlacePicker'
import { OnlineFeaturesForm } from './OnlineFeaturesForm'
import { messages } from '@/i18n'

/** What Review sends to the deploy: how and where it runs, the Advanced image (null: graphrt's own) and what people can use. */
export interface DeployChoice {
  mode: DeployMode
  area: ServerArea
  image: string | null
  features: OnlineFeatures
  /** Google Cloud: the project and region; null for the other providers. */
  cloudPlace: CloudPlace | null
  /** AWS: the region; null for the other providers. */
  region: string | null
}

interface ReviewStepProps {
  agentName: string
  review: DeployReview
  isUpdate: boolean
  onCliChanged: (cli: CliInfo) => void
  onBack: () => void
  onConfirm: (choice: DeployChoice) => void
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
          {isInstalling ? messages().deploy.downloading : messages().deploy.allowDownload}
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
const awsModes: DeployMode[] = ['scale_to_zero']

/** The choices without what needs a store (AWS Lambda before it has one). */
function withoutStoreFeatures(features: OnlineFeatures): OnlineFeatures {
  return { ...features, phone: false, notifications: false, notifyEmail: null, whatsapp: false, teams: false }
}

/**
 * Review: what will be created, how it runs (Always ready / Saves money), where (Asia / Europe /
 * US), which keys are copied (by friendly name), the cost note and the billing checkbox.
 * "Put it online" stays off until the box is ticked, the tools are there and the provider can deploy.
 */
export function ReviewStep({ agentName, review, isUpdate, onCliChanged, onBack, onConfirm }: ReviewStepProps) {
  // AWS Lambda only scales to zero.
  const [mode, setMode] = useState<DeployMode>(review.provider === 'aws' ? 'scale_to_zero' : review.mode)
  const [area, setArea] = useState<ServerArea>(review.area)
  const [image, setImage] = useState(review.image ?? '')
  const [features, setFeatures] = useState<OnlineFeatures>(review.features)
  // Asked from the installed tools themselves: a version too old for these gets a plain note.
  const featuresAvailability: FeaturesAvailability = review.cli.status !== 'installed' ? 'needs_tools' : review.cli.onlineFeatures ? 'ready' : 'needs_newer_tools'
  const [acceptsBilling, setAcceptsBilling] = useState(isUpdate)
  const [cloudPlace, setCloudPlace] = useState<CloudPlace | null>(review.cloudPlace)
  const onCloudPlaceChange = useCallback((place: CloudPlace | null) => setCloudPlace(place), [])
  const providerName = deployProviderNames[review.provider]
  const isFly = review.provider === 'fly'
  const isGoogleCloud = review.provider === 'google_cloud'
  const isAws = review.provider === 'aws'
  const awsWords = messages().deploy.aws
  const [awsRegion, setAwsRegion] = useState<string | null>(review.region)
  const onAwsRegionChange = useCallback((region: string) => setAwsRegion(region), [])
  const googleWords = messages().deploy.googleCloud
  const needsPlace = (isGoogleCloud && cloudPlace === null) || (isAws && !awsRegion)
  const blockedReason = !review.canDeploy
    ? messages().deploy.puttingAgentsOnlineWithProvidernameIs(providerName)
    : !review.providerConnected
      ? messages().deploy.connectProvidernameFirst(providerName)
      : needsPlace
        ? googleWords.pickProjectFirst
        : null
  const canConfirm = review.canDeploy && review.providerConnected && review.cli.status === 'installed' && acceptsBilling && !needsPlace

  return (
    <section aria-label={messages().deploy.review} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[20px] font-semibold tracking-[-0.2px]">{messages().deploy.review}</h2>
        <span className="text-body">
          {agentName} {messages().deploy.on}{' '}{providerName}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-3">
        <ReviewSection title={messages().deploy.whatWillBeCreated}>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            <CreatedItem title={messages().deploy.anOnlineCopyOfAgentname(agentName)} detail={messages().deploy.onProvidernameInYourAccount(providerName)} />
            <CreatedItem title={messages().deploy.itsWebAddress} detail={review.expectedAddress} />
            <CreatedItem title={messages().deploy.aSmallStorageSpace} detail={isGoogleCloud ? googleWords.whatGetsCreated : isAws ? awsWords.whatGetsCreated : messages().deploy.keepsItsHistoryAndConversationsWaiting} />
          </ul>
        </ReviewSection>
        <ReviewSection title={messages().deploy.howItRuns}>
          <div role="radiogroup" aria-label={messages().deploy.howItRuns} className="flex flex-col gap-2">
            {(isAws ? awsModes : modes).map((option) => (
              <label key={option} className={joinClassNames('flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5', mode === option ? 'border-ink' : 'border-line')}>
                <input type="radio" name="deploy-mode" checked={mode === option} onChange={() => setMode(option)} className="mt-1 accent-[var(--color-ink)]" />
                <span className="flex flex-col">
                  <span className="font-medium">{deployModeLabels[option].title}</span>
                  <span className="text-[13px] text-body">{deployModeLabels[option].detail}</span>
                </span>
              </label>
            ))}
          </div>
          {isAws && <span className="text-[12px] leading-normal text-muted">{awsWords.onlyScaleToZero}</span>}
          <DevelopersDetails>
            <label className="flex items-start gap-2 opacity-60">
              <input type="checkbox" disabled className="mt-0.5" />
              <span>
                {messages().deploy.useAWakeUpService}{' '}<Badge>{messages().deploy.preview}</Badge> {messages().deploy.keepsConversationsSafeWhileTheAgent}
              </span>
            </label>
          </DevelopersDetails>
        </ReviewSection>
        {isGoogleCloud ? (
          <ReviewSection title={googleWords.whereTitle}>
            {review.providerConnected ? (
              <GoogleCloudPlacePicker current={review.cloudPlace} isLocked={isUpdate && review.cloudPlace !== null} onChange={onCloudPlaceChange} />
            ) : (
              <span className="text-[13px] text-body">{messages().deploy.connectProvidernameFirst(providerName)}</span>
            )}
          </ReviewSection>
        ) : isAws ? (
          <ReviewSection title={awsWords.regionTitle}>
            <AwsRegionPicker current={review.region} isLocked={isUpdate && review.region !== null} onChange={onAwsRegionChange} />
          </ReviewSection>
        ) : (
          <ReviewSection title={messages().deploy.serverLocation}>
            <label className="flex flex-col gap-1.5 text-[13px] text-body">
              {messages().deploy.pickWhereMostOfYourCustomers}
              <select aria-label={messages().deploy.serverLocation} value={area} onChange={(event) => setArea(event.target.value as ServerArea)} className="h-10 rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink">
                {areas.map((option) => (
                  <option key={option} value={option}>
                    {serverAreaLabels[option]}
                  </option>
                ))}
              </select>
            </label>
          </ReviewSection>
        )}
        <ReviewSection title={messages().deploy.keysThatWillBeCopied}>
          {review.keys.length === 0 ? (
            <span className="text-[13px] text-body">{messages().deploy.noneThisAgentUsesNoKeys}</span>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {review.keys.map((key) => (
                <li key={key.envName} className="flex items-start justify-between gap-3">
                  <span className="flex flex-col">
                    <span className="font-medium">{key.friendlyName}</span>
                    <span className="text-[13px] text-body">{key.purpose}</span>
                  </span>
                  <Badge tone={key.isSaved ? 'ok' : 'amber'}>{key.isSaved ? messages().deploy.copiedSafely : messages().deploy.missing}</Badge>
                </li>
              ))}
            </ul>
          )}
          <span className="text-[12px] text-muted">{messages().deploy.theyGoStraightTo}{' '}{providerName}{messages().deploy.sSafeStorageNeverShownOr}</span>
        </ReviewSection>
      </div>
      <OnlineFeaturesForm value={features} onChange={setFeatures} providerName={providerName} availability={featuresAvailability} phoneWasOn={review.features.phone} withStore={review.storeFeatures} />
      <ReviewSection title={messages().deploy.monthlyCost}>
        <span className="text-[13px] leading-normal text-body">
          {messages().deploy.billedBy}{' '}{providerName} {messages().deploy.toYourAccountSeeTheirPricing}{' '}
          {isFly && (
            <button type="button" onClick={() => void openDeployLink('fly_pricing')} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-brand hover:underline">
              {messages().deploy.flyIoPricing}
            </button>
          )}
          {isAws && (
            <button type="button" onClick={() => void openDeployLink('aws_pricing')} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-brand hover:underline">
              {awsWords.pricing}
            </button>
          )}
          {isGoogleCloud && (
            <button type="button" onClick={() => void openGoogleCloudPage('pricing', null)} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-brand hover:underline">
              {googleWords.pricing}
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
        <span>{messages().deploy.iUnderstand}{' '}{providerName} {messages().deploy.billsMeForThis}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onConfirm({ mode, area, image: image.trim() || null, features: featuresAvailability === 'ready' ? (review.storeFeatures ? features : withoutStoreFeatures(features)) : noOnlineFeatures, cloudPlace: isGoogleCloud ? cloudPlace : null, region: isAws ? awsRegion : null })} disabled={!canConfirm}>
          {!review.canDeploy ? messages().deploy.comingSoon : isUpdate ? messages().deploy.updateOnlineVersion : messages().deploy.putItOnline}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {messages().deploy.back}
        </Button>
      </div>
      <DevelopersDetails>
        {isAws ? (
          <span>{awsWords.developers(review.deploymentName, awsRegion ?? '…')}</span>
        ) : isGoogleCloud ? (
          <span>{googleWords.developers(review.deploymentName, cloudPlace?.project ?? '…', cloudPlace?.region ?? '…')}</span>
        ) : (
          <span>
            {isFly ? messages().deploy.flyApp : messages().deploy.deployment} <code>{review.deploymentName}</code> {messages().deploy.region2}{' '}<code>{{ asia: 'sin', europe: 'fra', us: 'iad' }[area]}</code> ·{' '}
            {mode === 'scale_to_zero' ? messages().deploy.autostopMin0Machines : messages().deploy.min1Machine} {messages().deploy.storageVolumeForRunsSecrets}{' '}
            {review.keys.map((key) => key.envName).join(', ') || 'none'}{messages().deploy.plus}{' '}<code>{messages().deploy.graphrtApiKey}</code> {messages().deploy.onTheFirstDeployRuns}{' '}<code>{messages().deploy.graphrtDeployTargetFlyDirect}</code>{messages().deploy.secretsGoToTheToolAs}
          </span>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-ink-2">{messages().deploy.serverImageOptional}</span>
          <input
            aria-label={messages().deploy.serverImage}
            value={image}
            onChange={(event) => setImage(event.target.value)}
            placeholder={messages().deploy.graphrtsOwnImage}
            autoComplete="off"
            spellCheck={false}
            className="box-border h-9 w-full rounded-lg border border-line-strong bg-surface px-3 font-mono text-[12px] text-ink"
          />
          <span className="text-[12px] text-muted">
            {messages().deploy.leaveEmptyToUse}{' '}<code>{messages().deploy.graphrtImage}</code> {messages().deploy.atTheVersionOfTheGraphrt}{' '}<code>{messages().deploy.graphrtServe}</code> {messages().deploy.passedAs}{' '}<code>{messages().deploy.image}</code>).
          </span>
        </label>
      </DevelopersDetails>
    </section>
  )
}
