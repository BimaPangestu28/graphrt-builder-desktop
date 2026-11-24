import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { connectDeployAccount, openDeployLink, readKubeconfigContexts } from '@/api/deploy'
import { deployProviderNames, type DeployAccount, type DeployAccountInput, type DeployLink, type DeployProvider } from '@/api/deployTypes'
import { pickFilePaths } from '@/api/fileDrop'
import { FileDropZone, type FileDropAccept } from '@/components/fileDrop'
import { Button, Icon } from '@/components/ui'
import { lastPathSegment } from '@/lib/fileDrop'
import { getCredentialStoreName } from '@/lib/platform'
import { DeployDialog, DevelopersDetails, GuideSteps } from './DeployDialog'
import { plainErrorMessage } from './deployDisplay'
import { ProviderLogo } from './ProviderLogo'

const inputClassName = 'box-border h-10 w-full rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-ink'

interface ConnectProviderDialogProps {
  provider: DeployProvider
  onClose: () => void
  onConnected: (account: DeployAccount) => void
}

/** What each provider's form produces: a complete input, or null while something is missing. */
type BuildInput = () => DeployAccountInput | null

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
          Remove
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
      chooseLabel="Choose file…"
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
          'Sign in or create an account at fly.io',
          <>Open <b>Tokens</b> in your dashboard</>,
          <>
            Create an <b>organization</b> token named “graphrt” (not a deploy token for one app) and copy it
          </>,
          'Paste it below',
        ]}
      />
      <GuideLink link="fly_tokens">Open Fly.io tokens page</GuideLink>
      <TextField label="Paste your access key" type="password" value={accessToken} onChange={setAccessToken} placeholder="FlyV1 …" />
      <p className="m-0 text-[13px] leading-normal text-muted">
        This key lets graphrt put your agents online, update them and take them offline in your Fly.io account. It needs to be an organization token: putting an agent online the first time
        creates its app, and taking it offline deletes it. Kept in {getCredentialStoreName()}, never shown again.
      </p>
      <DevelopersDetails>
        <span>
          With flyctl: <code className="break-all">fly tokens create org &lt;your-org&gt; --expiry 720h</code> (your organization slug, e.g. <code>personal</code>). A deploy token (
          <code>fly tokens create deploy -a &lt;app&gt;</code>) can update an agent that is already online, but can't put a new one online or take one offline. Prefer an organization
          made for these agents, and revoke the token with <code>fly tokens revoke</code> when you no longer need it.
        </span>
      </DevelopersDetails>
    </>
  )
}

function GoogleCloudForm({ onBuild }: { onBuild: (build: BuildInput) => void }) {
  const [keyFilePath, setKeyFilePath] = useState<string | null>(null)
  onBuild(() => (keyFilePath ? { provider: 'google_cloud', keyFilePath } : null))
  return (
    <>
      <GuideSteps
        steps={[
          'In Google Cloud, create a service account named “graphrt”',
          'Give it these roles (your IT team will know): Cloud Run Developer, Service Account User, Secret Manager Admin',
          'Create a key for it and download the file',
        ]}
      />
      <GuideLink link="google_cloud_keys">How to create a key file</GuideLink>
      <KeyFileField itemDescription="your key file (.json)" accept={{ extensions: ['json'] }} hint="The .json key file of the service account" pickerTitle="Choose the Google Cloud key file" path={keyFilePath} onChange={setKeyFilePath} />
      <p className="m-0 text-[13px] leading-normal text-muted">This file lets graphrt put agents online in your Google Cloud project. Kept in {getCredentialStoreName()}, never shown again.</p>
    </>
  )
}

function AwsForm({ onBuild }: { onBuild: (build: BuildInput) => void }) {
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [sessionToken, setSessionToken] = useState('')
  onBuild(() => (accessKeyId.trim() && secretAccessKey.trim() ? { provider: 'aws', accessKeyId, secretAccessKey, sessionToken: sessionToken.trim() || null } : null))
  return (
    <>
      <GuideSteps steps={['Ask your IT team for an access key made for graphrt', 'Paste the access key ID and its secret below']} />
      <GuideLink link="aws_access_keys">About AWS access keys</GuideLink>
      <TextField label="Access key ID" value={accessKeyId} onChange={setAccessKeyId} placeholder="AKIA…" />
      <TextField label="Secret access key" type="password" value={secretAccessKey} onChange={setSecretAccessKey} />
      <DevelopersDetails>
        <TextField label="Session token (only for temporary keys)" type="password" value={sessionToken} onChange={setSessionToken} />
      </DevelopersDetails>
      <p className="m-0 text-[13px] leading-normal text-muted">These let graphrt put agents online in your AWS account. Kept in {getCredentialStoreName()}, never shown again.</p>
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
        steps={["Ask your IT team for the tenant ID and app (client) ID of graphrt's app registration", 'Ask for its certificate file, or a client secret', 'Fill them in below']}
      />
      <GuideLink link="azure_app_registrations">About app registrations</GuideLink>
      <TextField label="Tenant ID" value={tenantId} onChange={setTenantId} placeholder="00000000-0000-0000-0000-000000000000" />
      <TextField label="App (client) ID" value={clientId} onChange={setClientId} placeholder="00000000-0000-0000-0000-000000000000" />
      {usesSecret ? (
        <TextField label="Client secret" type="password" value={clientSecret} onChange={setClientSecret} />
      ) : (
        <KeyFileField itemDescription="the certificate file (.pem)" accept={{ extensions: ['pem', 'crt', 'cer'] }} hint="A .pem file with the certificate and its private key" pickerTitle="Choose the certificate file" path={certificatePath} onChange={setCertificatePath} />
      )}
      <button type="button" onClick={() => setUsesSecret(!usesSecret)} className="w-fit cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand hover:underline">
        {usesSecret ? 'Use a certificate file instead' : 'No certificate? Paste a client secret instead'}
      </button>
      <p className="m-0 text-[13px] leading-normal text-muted">These let graphrt put agents online in your Azure subscription. Kept in {getCredentialStoreName()}, never shown again.</p>
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
      <GuideSteps steps={['Ask your IT team for a kubeconfig file for graphrt', 'Drop it below and pick the cluster to use']} />
      <KeyFileField
        itemDescription="the kubeconfig file"
        accept={{ extensions: ['yaml', 'yml', 'config', 'conf', 'kubeconfig'] }}
        hint="Usually named config or kubeconfig.yaml"
        pickerTitle="Choose the kubeconfig file"
        path={kubeconfigPath}
        checkedText={contexts.length > 0 ? `Checked: ${contexts.length} cluster${contexts.length === 1 ? '' : 's'} found` : null}
        onChange={(path) => void chooseFile(path)}
      />
      {readError && <p role="alert" className="m-0 text-[13px] text-danger">{readError}</p>}
      {contexts.length > 0 && (
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
          Cluster to use
          <select value={context} onChange={(event) => setContext(event.target.value)} className={inputClassName}>
            {contexts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="m-0 text-[13px] leading-normal text-muted">This file lets graphrt run agents on your cluster. Kept in {getCredentialStoreName()}, never shown again.</p>
    </>
  )
}

const forms: Record<DeployProvider, (props: { onBuild: (build: BuildInput) => void }) => JSX.Element> = {
  fly: FlyForm,
  google_cloud: GoogleCloudForm,
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = buildInputRef.current()
    if (!input) {
      setErrorMessage('Fill in everything above first')
      return
    }
    setIsConnecting(true)
    setErrorMessage(null)
    try {
      const account = await connectDeployAccount(input)
      setConnectedAccount(account)
      onConnected(account)
    } catch (error) {
      setErrorMessage(plainErrorMessage(error))
    } finally {
      setIsConnecting(false)
    }
  }

  if (connectedAccount) {
    return (
      <DeployDialog title={`Connect ${providerName}`} leading={<ProviderLogo provider={provider} />} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
        <div role="status" className="flex items-start gap-3 rounded-[12px] border border-ok-soft bg-ok-tint px-4 py-3">
          <Icon name="check" size={18} className="mt-0.5 shrink-0 text-ok" />
          <span className="leading-normal">
            <b className="font-semibold">Connected.</b> {providerName} is ready.{' '}
            {connectedAccount.canDeploy ? 'You can now pick it for any agent.' : 'Putting agents online with it is coming soon.'}
            {connectedAccount.summary && <span className="block text-[13px] text-muted">{connectedAccount.summary}</span>}
          </span>
        </div>
      </DeployDialog>
    )
  }

  return (
    <DeployDialog title={`Connect ${providerName}`} leading={<ProviderLogo provider={provider} />} onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} aria-label={`Connect ${providerName}`} className="flex flex-col gap-4">
        <Form onBuild={(build) => (buildInputRef.current = build)} />
        {errorMessage && (
          <p role="alert" className="m-0 rounded-[10px] border border-danger-line bg-danger-tint px-3 py-2 text-[13px] text-danger-deep">
            {errorMessage}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isConnecting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isConnecting}>
            {isConnecting ? `Connecting… checking with ${providerName}` : errorMessage ? 'Try again' : 'Connect'}
          </Button>
        </div>
      </form>
    </DeployDialog>
  )
}
