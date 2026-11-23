import { useState } from 'react'
import { addTrustedLookupHost } from '@/api/trustedHosts'
import { TrustedHostsSection } from '@/components/TrustedHostsSection'
import { joinClassNames } from '@/components/ui'
import { toErrorMessage } from '@/lib/errors'
import { hintClassName, InspectorSection } from './fields'
import { useInspector } from './InspectorContext'

const trustButtonClassNames =
  'h-7 cursor-pointer self-start rounded-md border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50'

/**
 * The HTTP request inspector's "Asking first" section: whether this request runs without
 * asking and why (`GraphNode.requestCheck`, from the backend's check of the saved version),
 * a "Trust <host> for lookups" button when trusting its host is all it needs, and the
 * agent's trusted hosts. Trusting is always the user's click.
 */
export function RequestCheckSection() {
  const { node, graph, controller } = useInspector()
  const [isTrusting, setIsTrusting] = useState(false)
  const [trustError, setTrustError] = useState<string | null>(null)
  const check = node.requestCheck ?? null
  const trustableHost = check?.trustableHost ?? null

  async function trustHost(host: string) {
    setIsTrusting(true)
    try {
      await addTrustedLookupHost(graph.agentId, host)
      setTrustError(null)
    } catch (rawError) {
      setTrustError(`Could not trust ${host}: ${toErrorMessage(rawError)}`)
    } finally {
      setIsTrusting(false)
    }
  }

  return (
    <InspectorSection title="Asking first" sectionKey="asking-first">
      {check && (
        <p data-testid="request-check" className="m-0 flex flex-col gap-0.5 text-[12px] leading-normal">
          <span className={joinClassNames('font-semibold', check.runsWithoutAsking ? 'text-ok-strong' : 'text-amber-strong')}>{check.runsWithoutAsking ? 'Runs without asking' : 'Asks you first'}</span>
          <span className="text-body">{check.reason}</span>
        </p>
      )}
      {controller.isDirty && <p className={hintClassName}>Checked again once your changes are saved</p>}
      {trustableHost && (
        <button type="button" disabled={isTrusting} onClick={() => void trustHost(trustableHost)} className={trustButtonClassNames}>
          Trust {trustableHost} for lookups
        </button>
      )}
      {trustError && (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {trustError}
        </p>
      )}
      <TrustedHostsSection agentId={graph.agentId} isCompact />
    </InspectorSection>
  )
}
