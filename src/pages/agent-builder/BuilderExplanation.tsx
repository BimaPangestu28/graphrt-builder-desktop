import { useTrustedLookupHosts } from '@/hooks/useTrustedLookupHosts'
import { findTrustProposals } from '@/lib/trustProposals'
import { messages } from '@/i18n'

const trustButtonClassNames =
  'h-8 cursor-pointer self-start rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50'

/** "Trust <host> for lookups" buttons for the hosts a reply proposes (the user decides). */
function TrustProposalButtons({ agentId, proposedHosts }: { agentId: string; proposedHosts: string[] }) {
  const { hosts, isChanging, changeError, addHost } = useTrustedLookupHosts(agentId)
  if (!hosts) return null
  return (
    <div className="flex flex-col gap-1.5">
      {proposedHosts.map((host) =>
        hosts.includes(host) ? (
          <span key={host} className="text-[13px] text-ok-strong">
            {host} {messages().builder.isTrustedForLookups}
          </span>
        ) : (
          <button key={host} type="button" disabled={isChanging} onClick={() => void addHost(host)} className={trustButtonClassNames}>
            {messages().builder.trust}{' '}{host} {messages().builder.forLookups}
          </button>
        ),
      )}
      {changeError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {changeError.message}
        </p>
      )}
    </div>
  )
}

/**
 * A builder explanation in the chat. When it proposes trusting a site for lookups ("Trust
 * api.example.com for lookups"), each proposal becomes a button under it; nothing is trusted
 * until the user clicks. Without an agent (still building) the text shows alone.
 */
export function BuilderExplanation({ text, agentId }: { text: string; agentId: string | null }) {
  const proposedHosts = findTrustProposals(text)
  return (
    <>
      <p className="m-0 whitespace-pre-line leading-[1.55]">{text}</p>
      {agentId && proposedHosts.length > 0 && <TrustProposalButtons agentId={agentId} proposedHosts={proposedHosts} />}
    </>
  )
}
