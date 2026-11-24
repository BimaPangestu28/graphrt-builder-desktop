import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { applyDeployFix } from '@/api/deploy'
import type { CompatibilityItem, CompatibilityReport } from '@/api/deployTypes'
import { Button, Icon, joinClassNames } from '@/components/ui'
import { agentPath, builderAskParam, connectionsTabPath } from '@/routes'
import { DevelopersDetails } from './DeployDialog'
import { plainErrorMessage } from './deployDisplay'

/** The builder request behind "Switch to WhatsApp Business" (the person still presses Send). */
export const switchWhatsAppRequest =
  'So this agent can run online: replace the WhatsApp Web steps with the WhatsApp Business plugin (whatsapp-api, the official WhatsApp Cloud API), keeping what each step does.'

interface CompatibilityChecklistProps {
  agentId: string
  agentName: string
  report: CompatibilityReport
  /** Loads the checklist again (after a fix, or "Check again"). */
  onRecheck: () => Promise<void> | void
  onContinue: () => void
  onKeepLocal: () => void
}

const levelIcons = {
  blocker: { name: 'alert', className: 'text-amber' },
  info: { name: 'info', className: 'text-brand' },
  ok: { name: 'check', className: 'text-ok' },
} as const

function ChecklistRow({ item, agentId, onFixed, onKeepLocal }: { item: CompatibilityItem; agentId: string; onFixed: () => Promise<void> | void; onKeepLocal: () => void }) {
  const navigate = useNavigate()
  const [isFixing, setIsFixing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const icon = levelIcons[item.level]

  async function applyFix() {
    if (!item.fix) return
    if (item.fix.kind === 'switch_whats_app_to_cloud') {
      navigate(agentPath('builder', agentId, { [builderAskParam]: switchWhatsAppRequest }))
      return
    }
    setIsFixing(true)
    setErrorMessage(null)
    try {
      await applyDeployFix(agentId, item.fix)
      await onFixed()
    } catch (error) {
      setErrorMessage(plainErrorMessage(error))
    } finally {
      setIsFixing(false)
    }
  }

  return (
    <li className={joinClassNames('flex flex-col gap-2 rounded-[14px] border px-4 py-3.5', item.level === 'blocker' ? 'border-amber-line bg-amber-tint' : 'border-line bg-surface')}>
      <div className="flex items-start gap-3">
        <Icon name={icon.name} size={18} className={joinClassNames('mt-0.5 shrink-0', icon.className)} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold leading-snug">{item.title}</span>
          <span className="text-[13px] leading-normal text-body">{item.detail}</span>
        </span>
      </div>
      {item.level === 'blocker' && (
        <div className="flex flex-wrap gap-2 pl-[30px]">
          {item.fix && item.fixLabel && (
            <Button size="sm" onClick={() => void applyFix()} disabled={isFixing}>
              {isFixing ? 'Changing…' : item.fixLabel}
            </Button>
          )}
          {!item.fix && item.id.startsWith('model:') && (
            <Button size="sm" variant="secondary" onClick={() => navigate(connectionsTabPath('models'))}>
              Connect an AI service
            </Button>
          )}
          {!item.fix && item.id.startsWith('key:') && (
            <Button size="sm" variant="secondary" onClick={() => navigate(connectionsTabPath('secrets'))}>
              Open Secrets
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onKeepLocal}>
            Keep it on this computer
          </Button>
        </div>
      )}
      {errorMessage && (
        <p role="alert" className="m-0 pl-[30px] text-[13px] text-danger">
          {errorMessage}
        </p>
      )}
    </li>
  )
}

/**
 * "Before it can go online": blockers with their one-click fixes, then what goes along. Each
 * fix is a normal, undoable change (History). Continue unlocks once nothing blocks.
 */
export function CompatibilityChecklist({ agentId, agentName, report, onRecheck, onContinue, onKeepLocal }: CompatibilityChecklistProps) {
  const blockerCount = report.items.filter((item) => item.level === 'blocker').length
  const [isChecking, setIsChecking] = useState(false)
  async function recheck() {
    setIsChecking(true)
    try {
      await onRecheck()
    } finally {
      setIsChecking(false)
    }
  }
  return (
    <section aria-label="Before it can go online" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[20px] font-semibold tracking-[-0.2px]">
          {blockerCount === 0 ? 'Ready to go online' : `${blockerCount} thing${blockerCount === 1 ? '' : 's'} to change before this agent can run online`}
        </h2>
        <span className="text-body">{agentName}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {report.items.map((item) => (
          <ChecklistRow key={item.id} item={item} agentId={agentId} onFixed={recheck} onKeepLocal={onKeepLocal} />
        ))}
      </ul>
      {blockerCount > 0 && <p className="m-0 text-[13px] text-muted">Each fix is a normal change to your agent. You can undo it from History.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onContinue} disabled={blockerCount > 0}>
          Continue
        </Button>
        <Button variant="secondary" onClick={() => void recheck()} disabled={isChecking}>
          {isChecking ? 'Checking…' : 'Check again'}
        </Button>
        {blockerCount > 0 && <span className="text-[13px] text-muted">Continue unlocks when everything above is fixed</span>}
      </div>
      <DevelopersDetails>
        <span>
          The check compares the agent's steps, plugins, AI models and keys with what runs online. Blocked: local-only plugins (WhatsApp Web, browser plugins),
          AI tools installed on this computer (Claude Code, Codex and others) and Ollama. Knowledge is copied with the agent.
        </span>
      </DevelopersDetails>
    </section>
  )
}
