import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { connectAwsProfile, connectDeployAccount, listAwsProfiles, openDeployLink, readKubeconfigContexts, signInGoogleCloud } from '@/api/deploy'
import { deployProviderNames, type AwsProfile, type DeployAccount, type DeployAccountInput, type DeployLink, type DeployProvider } from '@/api/deployTypes'
import { pickFilePaths } from '@/api/fileDrop'
import { FileDropZone, type FileDropAccept } from '@/components/fileDrop'
import { Button, Icon } from '@/components/ui'
import { lastPathSegment } from '@/lib/fileDrop'
import { getCredentialStoreName } from '@/lib/platform'
import { DeployDialog, DevelopersDetails, GuideSteps } from './DeployDialog'
import { plainErrorMessage } from './deployDisplay'
import { graphrtAwsPolicyText } from './aws'
import { ProviderLogo } from './ProviderLogo'
import { messages } from '@/i18n'

const inputClassName = 'box-border h-10 w-full rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-ink'

interface ConnectProviderDialogProps {
  provider: DeployProvider
  onClose: () => void
  onConnected: (account: DeployAccount) => void
}

/** What each provider's form produces: a complete input, or null while something is missing. */
type BuildInput = () => DeployAccountInput | null

/** A form hands over how to build its input, or connects by itself (an AWS profile of this computer). */
interface FormProps {
  onBuild: (build: BuildInput) => void
  onConnected: (account: DeployAccount) => void
}

function TextField({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
      {label}
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={inputClassName} autoComplete="off" spellCheck={false} />
    </label>
  )
}

function GuideLink({ link, children }: { link: DeployLink; children: ReactNode }) {
  return (
    <button type="button" onClick={() => void openDeployLink(link)} className="inline-flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13px] font-semibold text-brand hover:underline">
      {children}
      <Icon name="arrowRight" size={13} />
    </button>
  )
}

interface KeyFileFieldProps {
  itemDescription: string
  accept: FileDropAccept
  hint: string
  pickerTitle: string
  path: string | null
  /** e.g. "Checked: 3 contexts" after a backend check. */
  checkedText?: string | null
  onChange: (path: string | null) => void
}

/** A key file: dropped or picked (a path the backend reads), shown by name with Remove. */
function KeyFileField({ itemDescription, accept, hint, pickerTitle, path, checkedText, onChange }: KeyFileFieldProps) {
  if (path) {
    return (
      <div className="flex items-center gap-3 rounded-[12px] border border-line bg-subtle px-3.5 py-3">
        <Icon name="file" size={18} className="shrink-0 text-muted" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{lastPathSegment(path)}</span>
          {checkedText && <span className="text-[12px] text-ok-strong">{checkedText}</span>}
        </span>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          {messages().deploy.remove}
        </Button>
      </div>
    )
  }
  return (
    <FileDropZone
      compact
      itemDescription={itemDescription}
      accept={accept}
      onDrop={([item]) => onChange(item.path)}
      chooseLabel={messages().deploy.chooseFile}
      onChoose={() => void pickFilePaths(pickerTitle, false).then(([picked]) => picked && onChange(picked))}
      hint={hint}
    />
  )
}

function FlyForm({ onBuild }: { onBuild: (build: BuildInput) => void }) {
  const [accessToken, setAccessToken] = useState('')
  onBuild(() => (accessToken.trim() ? { provider: 'fly', accessToken } : null))
  return (
    <>
      <GuideSteps
        steps={[
          messages().deploy.signInOrCreateAnAccount,
          <>{messages().deploy.open}{' '}<b>{messages().deploy.tokens}</b> {messages().deploy.inYourDashboard}</>,
          <>
            {messages().deploy.createAn}{' '}<b>{messages().deploy.organization}</b> {messages().deploy.tokenNamedGraphrtNotADeploy}
          </>,
          messages().deploy.pasteItBelow,
        ]}
      />
      <GuideLink link="fly_tokens">{messages().deploy.openFlyIoTokensPage}</GuideLink>
      <TextField label={messages().deploy.pasteYourAccessKey} type="password" value={accessToken} onChange={setAccessToken} placeholder={messages().deploy.flyv1} />
      <p className="m-0 text-[13px] leading-normal text-muted">
        {messages().deploy.thisKeyLetsGraphrtPutYour}{' '}{getCredentialStoreName()}{messages().deploy.neverShownAgain}
      </p>
      <DevelopersDetails>
        <span>
          {messages().deploy.withFlyctl}{' '}<code className="break-all">{messages().deploy.flyTokensCreateOrgLtYour}</code> {messages().deploy.yourOrganizationSlugEG}{' '}<code>{messages().deploy.personal}</code>{messages().deploy.aDeployToken}
          <code>{messages().deploy.flyTokensCreateDeployALt}</code>{messages().deploy.canUpdateAnAgentThatIs}{' '}<code>{messages().deploy.flyTokensRevoke}</code> {messages().deploy.whenYouNoLongerNeedIt}
        </span>
      </DevelopersDetails>
    </>
  )
}

/** Google Cloud has no form: the person signs in with Google in the browser. */
function GoogleCloudSignInGuide() {
  const words = messages().deploy.googleCloud
  return (
    <>
      <GuideSteps steps={[...words.signInSteps]} />
      <p className="m-0 text-[13px] leading-normal text-muted">{words.unverifiedNote}</p>
      <p className="m-0 text-[13px] leading-normal text-muted">{words.signInKept(getCredentialStoreName())}</p>
    </>
  )
}

/** The minimum IAM policy, shown with a Copy button (AWS console: Create inline policy, JSON). */
function AwsPolicy() {
  const words = messages().deploy.aws
  const [isCopied, setIsCopied] = useState(false)
  return (
    <details className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-body">
      <summary className="cursor-pointer font-medium text-ink-2">{words.policyTitle}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <span className="leading-normal">{words.policyHint}</span>
        <pre aria-label={words.policyTitle} className="m-0 max-h-[200px] overflow-auto rounded-lg bg-subtle p-3 font-mono text-[11px] leading-[1.5] text-ink-2">
          {graphrtAwsPolicyText}
        </pre>
        <span className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(graphrtAwsPolicyText)
              setIsCopied(true)
            }}
          >
            {isCopied ? words.policyCopied : words.copyPolicy}
          </Button>
          <GuideLink link="aws_iam_policy">{words.policyDocs}</GuideLink>
        </span>
      </div>
    </details>
  )
}

/** The AWS profiles of this computer that hold a key: one click connects with it. */
function AwsProfiles({ onConnected }: { onConnected: (account: DeployAccount) => void }) {
  const words = messages().deploy.aws
  const [profiles, setProfiles] = useState<AwsProfile[]>([])
  const [usingProfile, setUsingProfile] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  useEffect(() => {
    let isCurrent = true
    listAwsProfiles()
      .then((found) => isCurrent && setProfiles(found))
      .catch(() => isCurrent && setProfiles([]))
    return () => {
      isCurrent = false
    }
  }, [])
  if (profiles.length === 0) return null
  async function useProfile(name: string) {
    setUsingProfile(name)
    setErrorMessage(null)
    try {
      onConnected(await connectAwsProfile(name))
    } catch (error) {
      setErrorMessage(plainErrorMessage(error))
    } finally {
      setUsingProfile(null)
    }
  }
  return (
    <section aria-label={words.profilesTitle} className="flex flex-col gap-2 rounded-[12px] border border-line bg-subtle px-3.5 py-3">
      <span className="text-[13px] font-semibold text-ink-2">{words.profilesTitle}</span>
      <span className="text-[12px] text-muted">{words.profilesHint(getCredentialStoreName())}</span>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {profiles.map((profile) => (
          <li key={profile.name} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px]">
              <b className="font-medium">{profile.name}</b>
              {profile.region && <span className="text-muted"> · {words.profileRegion(profile.region)}</span>}
              {!profile.hasKeys && <span className="text-muted"> · {words.profileNoKeys}</span>}
            </span>
            {profile.hasKeys && (
              <Button size="sm" variant="secondary" disabled={usingProfile !== null} onClick={() => void useProfile(profile.name)}>
                {usingProfile === profile.name ? words.checkingWithAws : words.useProfile(profile.name)}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {errorMessage}
        </p>
      )}
      <span className="text-[12px] font-semibold text-ink-2">{words.orPasteKey}</span>
    </section>
  )
}

function AwsForm({ onBuild, onConnected }: FormProps) {
  const words = messages().deploy.aws
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [sessionToken, setSessionToken] = useState('')
  onBuild(() => (accessKeyId.trim() && secretAccessKey.trim() ? { provider: 'aws', accessKeyId, secretAccessKey, sessionToken: sessionToken.trim() || null } : null))
  return (
    <>
      <AwsProfiles onConnected={onConnected} />
      <GuideSteps steps={[...words.guideSteps]} />
      <span className="flex flex-wrap gap-4">
        <GuideLink link="aws_create_user">{words.openCreateUser}</GuideLink>
        <GuideLink link="aws_access_keys">{messages().deploy.aboutAwsAccessKeys}</GuideLink>
      </span>
      <AwsPolicy />
      <TextField label={messages().deploy.accessKeyId} value={accessKeyId} onChange={setAccessKeyId} placeholder={messages().deploy.akia} />
      <TextField label={messages().deploy.secretAccessKey} type="password" value={secretAccessKey} onChange={setSecretAccessKey} />
      <DevelopersDetails>
        <TextField label={messages().deploy.sessionTokenOnlyForTemporaryKeys} type="password" value={sessionToken} onChange={setSessionToken} />
      </DevelopersDetails>
      <p className="m-0 text-[13px] leading-normal text-muted">{messages().deploy.theseLetGraphrtPutAgentsOnline}{' '}{getCredentialStoreName()}{messages().deploy.neverShownAgain}</p>
    </>
  )
}

function AzureForm({ onBuild }: { onBuild: (build: BuildInput) => void }) {
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [certificatePath, setCertificatePath] = useState<string | null>(null)
  const [usesSecret, setUsesSecret] = useState(false)
  const [clientSecret, setClientSecret] = useState('')
  const hasCredential = usesSecret ? clientSecret.trim() !== '' : certificatePath !== null
  onBuild(() =>
    tenantId.trim() && clientId.trim() && hasCredential
      ? { provider: 'azure', tenantId, clientId, certificatePath: usesSecret ? null : certificatePath, clientSecret: usesSecret ? clientSecret : null }
      : null,
  )
  return (
    <>
      <GuideSteps
        steps={[messages().deploy.askYourItTeamForThe, messages().deploy.askForItsCertificateFileOr, messages().deploy.fillThemInBelow]}
      />
      <GuideLink link="azure_app_registrations">{messages().deploy.aboutAppRegistrations}</GuideLink>
      <TextField label={messages().deploy.tenantId} value={tenantId} onChange={setTenantId} placeholder="00000000-0000-0000-0000-000000000000" />
      <TextField label={messages().deploy.appClientId} value={clientId} onChange={setClientId} placeholder="00000000-0000-0000-0000-000000000000" />
      {usesSecret ? (
        <TextField label={messages().deploy.clientSecret} type="password" value={clientSecret} onChange={setClientSecret} />
      ) : (
        <KeyFileField itemDescription={messages().deploy.theCertificateFilePem} accept={{ extensions: ['pem', 'crt', 'cer'] }} hint={messages().deploy.aPemFileWithTheCertificate} pickerTitle={messages().deploy.chooseTheCertificateFile} path={certificatePath} onChange={setCertificatePath} />
      )}
      <button type="button" onClick={() => setUsesSecret(!usesSecret)} className="w-fit cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand hover:underline">
        {usesSecret ? messages().deploy.useACertificateFileInstead : messages().deploy.noCertificatePasteAClientSecret}
      </button>
      <p className="m-0 text-[13px] leading-normal text-muted">{messages().deploy.theseLetGraphrtPutAgentsOnline2}{' '}{getCredentialStoreName()}{messages().deploy.neverShownAgain}</p>
    </>
  )
}

function KubernetesForm({ onBuild }: { onBuild: (build: BuildInput) => void }) {
  const [kubeconfigPath, setKubeconfigPath] = useState<string | null>(null)
  const [contexts, setContexts] = useState<string[]>([])
  const [context, setContext] = useState('')
  const [readError, setReadError] = useState<string | null>(null)
  onBuild(() => (kubeconfigPath && context ? { provider: 'kubernetes', kubeconfigPath, context } : null))

  async function chooseFile(path: string | null) {
    setKubeconfigPath(path)
    setContexts([])
    setContext('')
    setReadError(null)
    if (!path) return
    try {
      const found = await readKubeconfigContexts(path)
      setContexts(found)
      setContext(found[0] ?? '')
    } catch (error) {
      setReadError(plainErrorMessage(error))
      setKubeconfigPath(null)
    }
  }

  return (
    <>
      <GuideSteps steps={[messages().deploy.askYourItTeamForA, messages().deploy.dropItBelowAndPickThe]} />
      <KeyFileField
        itemDescription={messages().deploy.theKubeconfigFile}
        accept={{ extensions: ['yaml', 'yml', 'config', 'conf', 'kubeconfig'] }}
        hint={messages().deploy.usuallyNamedConfigOrKubeconfigYaml}
        pickerTitle={messages().deploy.chooseTheKubeconfigFile}
        path={kubeconfigPath}
        checkedText={contexts.length > 0 ? messages().deploy.checkedValueClusterValue2Found(contexts.length, contexts.length === 1 ? '' : 's') : null}
        onChange={(path) => void chooseFile(path)}
      />
      {readError && <p role="alert" className="m-0 text-[13px] text-danger">{readError}</p>}
      {contexts.length > 0 && (
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
          {messages().deploy.clusterToUse}
          <select value={context} onChange={(event) => setContext(event.target.value)} className={inputClassName}>
            {contexts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="m-0 text-[13px] leading-normal text-muted">{messages().deploy.thisFileLetsGraphrtRunAgents}{' '}{getCredentialStoreName()}{messages().deploy.neverShownAgain}</p>
    </>
  )
}

/** Each provider's form; null for a provider signed in to in the browser (Google Cloud). */
const forms: Record<DeployProvider, ((props: FormProps) => JSX.Element) | null> = {
  fly: FlyForm,
  google_cloud: null,
  aws: AwsForm,
  azure: AzureForm,
  kubernetes: KubernetesForm,
}

/**
 * "Connect <provider>" popup: guided steps, the provider's details (a pasted key or a dropped
 * key file), checked by the backend and saved in the keychain. Shows "Connected" when done.
 */
export function ConnectProviderDialog({ provider, onClose, onConnected }: ConnectProviderDialogProps) {
  const providerName = deployProviderNames[provider]
  const [isConnecting, setIsConnecting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [connectedAccount, setConnectedAccount] = useState<DeployAccount | null>(null)
  // Each form hands over how to build its input on every render (latest values).
  const buildInputRef = useRef<BuildInput>(() => null)
  const Form = forms[provider]

  function finishConnecting(account: DeployAccount) {
    setConnectedAccount(account)
    onConnected(account)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = Form ? buildInputRef.current() : null
    if (Form && !input) {
      setErrorMessage(messages().deploy.fillInEverythingAboveFirst)
      return
    }
    setIsConnecting(true)
    setErrorMessage(null)
    try {
      const account = input ? await connectDeployAccount(input) : await signInGoogleCloud()
      setConnectedAccount(account)
      onConnected(account)
    } catch (error) {
      setErrorMessage(plainErrorMessage(error))
    } finally {
      setIsConnecting(false)
    }
  }

  const title = Form ? messages().deploy.connectProvidername(providerName) : messages().deploy.googleCloud.signInTitle
  const idleLabel = Form ? messages().deploy.connect : messages().deploy.googleCloud.signInButton
  const busyLabel = Form ? messages().deploy.connectingCheckingWithProvidername(providerName) : messages().deploy.googleCloud.waitingForBrowser

  if (connectedAccount) {
    return (
      <DeployDialog title={title} leading={<ProviderLogo provider={provider} />} onClose={onClose} footer={<Button onClick={onClose}>{messages().deploy.done}</Button>}>
        <div role="status" className="flex items-start gap-3 rounded-[12px] border border-ok-soft bg-ok-tint px-4 py-3">
          <Icon name="check" size={18} className="mt-0.5 shrink-0 text-ok" />
          <span className="leading-normal">
            <b className="font-semibold">{messages().deploy.connected2}</b> {providerName} {messages().deploy.isReady}{' '}
            {connectedAccount.canDeploy ? messages().deploy.youCanNowPickItFor : messages().deploy.puttingAgentsOnlineWithItIs}
            {connectedAccount.summary && <span className="block text-[13px] text-muted">{connectedAccount.summary}</span>}
          </span>
        </div>
      </DeployDialog>
    )
  }

  return (
    <DeployDialog title={title} leading={<ProviderLogo provider={provider} />} onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} aria-label={title} className="flex flex-col gap-4">
        {Form ? <Form onBuild={(build) => (buildInputRef.current = build)} onConnected={finishConnecting} /> : <GoogleCloudSignInGuide />}
        {errorMessage && (
          <p role="alert" className="m-0 rounded-[10px] border border-danger-line bg-danger-tint px-3 py-2 text-[13px] text-danger-deep">
            {errorMessage}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isConnecting}>
            {messages().deploy.cancel}
          </Button>
          <Button type="submit" disabled={isConnecting}>
            {isConnecting ? busyLabel : errorMessage ? messages().deploy.tryAgain : idleLabel}
          </Button>
        </div>
      </form>
    </DeployDialog>
  )
}
