import { forwardRef, useId, type ReactNode } from 'react'
import { Button } from '@/components/ui'
import { PluginRequirementCard } from './PluginRequirementCard'
import { needsPluginApproval, summarizePluginRequirements } from './pluginRequirementDisplay'
import { usePluginSetup, type PluginSetupState } from './usePluginSetup'
import { messages } from '@/i18n'

/** Element id of the setup message, so other parts of the screen can point at it. */
export const pluginSetupMessageId = 'plugin-setup'

interface PluginRequirementsMessageProps {
  setup: PluginSetupState
  /** Shown under the cards, e.g. screen 03's "Continue to steps". */
  footer?: ReactNode
}

/**
 * The builder's chat message listing the plugins the agent needs: a summary line, an
 * "Install all & trust" shortcut while approvals are pending, and one card per plugin.
 * Renders nothing until the requirements are loaded, or when the agent needs no plugin.
 * Focusable (tabIndex -1) so "Test" and "Set up in chat" can move the user here.
 */
export const PluginRequirementsMessage = forwardRef<HTMLDivElement, PluginRequirementsMessageProps>(function PluginRequirementsMessage({ setup, footer }, messageRef) {
  const summaryId = useId()
  const requirements = setup.requirements
  if (!requirements || requirements.length === 0) return null
  const pendingApprovalCount = requirements.filter(needsPluginApproval).length

  return (
    <div
      ref={messageRef}
      id={pluginSetupMessageId}
      role="group"
      aria-labelledby={summaryId}
      tabIndex={-1}
      className="flex max-w-[92%] flex-col gap-3 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <p className="m-0 leading-[1.55]">{messages().builder.beforeItCanRunThesePlugins}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={summaryId} className="font-semibold">
          {summarizePluginRequirements(requirements)}
        </span>
        {pendingApprovalCount > 0 && (
          <Button size="sm" variant="secondary" disabled={setup.isApprovingAll || setup.approvingNames.length > 0} onClick={() => void setup.approveAllPlugins()}>
            {setup.isApprovingAll ? messages().builder.settingUp : messages().builder.installAllTrust}
          </Button>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {requirements.map((requirement) => (
          <li key={requirement.name}>
            <PluginRequirementCard requirement={requirement} setup={setup} />
          </li>
        ))}
      </ul>
      {footer}
    </div>
  )
})

/** The setup message for one agent, loading its own requirements (test run screen after `missing_plugins`). */
export function AgentPluginSetupMessage({ agentId }: { agentId: string }) {
  const setup = usePluginSetup(agentId)
  return <PluginRequirementsMessage setup={setup} />
}

/**
 * Brings the setup message into view and moves focus to it (reduced motion: no smooth scroll).
 *
 * @param messageElement - The element of {@link PluginRequirementsMessage}, or null when not shown (HTMLElement | null)
 */
export function focusPluginSetupMessage(messageElement: HTMLElement | null): void {
  if (!messageElement) return
  const prefersReducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  messageElement.scrollIntoView?.({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
  messageElement.focus({ preventScroll: true })
}
