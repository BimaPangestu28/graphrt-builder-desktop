import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { exportAgentFile, listOwnServers, pickAgentFileSavePath, removeOwnServer } from '@/api/deploy'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Badge, Button, LinkButton, StatusDot } from '@/components/ui'
import { useAgent } from '@/hooks/useAgent'
import { useAsyncData } from '@/hooks/useAsyncData'
import { agentPath, sampleAgentId } from '@/routes'
import { ConnectServerDialog } from './deploy/ConnectServerDialog'
import { DevelopersDetails } from './deploy/DeployDialog'
import { plainErrorMessage } from './deploy/deployDisplay'

/** `menu-chatbot`: a file name from the agent's name. */
function fileNameFor(agentName: string): string {
  return agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

function dockerInstructions(fileName: string): string {
  return [
    `docker run -d --name ${fileName} -p 8080:8080 \\`,
    '  -v "$PWD/bundles:/workflows:ro" \\',
    '  -e GRAPHRT_API_KEY=<generate one> \\',
    '  -e OPENAI_API_KEY=<your OpenAI key> \\',
    '  ghcr.io/bimapangestu28/graphrt',
  ].join('\n')
}

function AgentFileCard({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  async function download() {
    setErrorMessage(null)
    const path = await pickAgentFileSavePath(fileNameFor(agentName))
    if (!path) return
    setIsSaving(true)
    try {
      setSavedPath(await exportAgentFile(agentId, path))
    } catch (error) {
      setErrorMessage(plainErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5">
      <h2 className="m-0 text-[17px] font-semibold">Give it to your IT team</h2>
      <span className="leading-normal text-body">One file with your agent. Your keys are not inside: your IT team adds them on the server.</span>
      <Button className="w-fit" onClick={() => void download()} disabled={isSaving}>
        {isSaving ? 'Saving…' : 'Download agent file (.grt)'}
      </Button>
      {savedPath && (
        <span role="status" className="text-[13px] text-ok-strong">
          Saved to {savedPath}
        </span>
      )}
      {errorMessage && (
        <span role="alert" className="text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
      <DevelopersDetails summary="Instructions for your IT team">
        <span>Put the .grt file in ./bundles, then run graphrt with Docker:</span>
        <pre className="m-0 overflow-x-auto rounded-lg bg-subtle p-3 font-mono text-[12px] leading-[1.6] text-ink-2">{dockerInstructions(fileNameFor(agentName))}</pre>
        <span>Save as .yaml in the dialog for the plain workflow document instead. Knowledge bases are not inside the file yet.</span>
      </DevelopersDetails>
    </section>
  )
}

function RunningServers() {
  const serversState = useAsyncData(listOwnServers, [])
  const [isConnecting, setIsConnecting] = useState(false)
  const servers = serversState.data ?? []
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5">
      <h2 className="m-0 flex items-center gap-2 text-[17px] font-semibold">
        A server that's already running <Badge>For IT teams</Badge>
      </h2>
      <span className="text-body">See its runs here once it's connected.</span>
      {servers.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {servers.map(({ server, health }) => (
            <li key={server.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line px-4 py-3">
              <StatusDot tone={health?.healthy ? 'ok' : 'amber'} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{server.name}</span>
                <span className="text-[13px] text-body">{health?.healthy ? 'Connected' : health?.message}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => void removeOwnServer(server.id).then(serversState.reload)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" className="w-fit" onClick={() => setIsConnecting(true)}>
        Connect a running server
      </Button>
      {isConnecting && <ConnectServerDialog onClose={() => setIsConnecting(false)} onConnected={() => void serversState.reload()} />}
    </section>
  )
}

/** Screen 67 · My own server (For IT teams): the agent file to hand over, and connecting a running server. */
export function OwnServerPage() {
  const agentId = useParams().agentId ?? sampleAgentId
  const { data: agent } = useAgent(agentId)
  const agentName = agent?.name ?? 'This agent'
  return (
    <AppShell agents={{ kind: 'list', activeAgentId: agentId }}>
      <PageFrame ariaLabel="My own server" className="gap-5">
        <PageTitleBlock
          title="My own server"
          subtitle={`For IT teams · ${agentName}`}
          actions={
            <LinkButton to={agentPath('builder', agentId)} variant="secondary">
              Back to the agent
            </LinkButton>
          }
        />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] gap-4">
          <AgentFileCard agentId={agentId} agentName={agentName} />
          <RunningServers />
        </div>
      </PageFrame>
    </AppShell>
  )
}
