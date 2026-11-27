import type { ReactNode } from 'react'
import { LinkButton, joinClassNames } from '@/components/ui'
import { isPluginRemedy, type ErrorHelp, type ErrorRemedy } from '@/lib/errorHelp'
import { humanizePluginName } from '@/lib/pluginDisplayName'
import { pluginDetailPath, pluginSettingsPath, routePaths } from '@/routes'
import { messages } from '@/i18n'

/**
 * An error explained in plain words: what went wrong, what to do next, a button to the page
 * that fixes it, and the original message underneath, always visible (it is the only place
 * that names the value, file or setting the error is about).
 */

interface RemedyLink {
  to: string
  label: string
}

function remedyLink(remedy: ErrorRemedy | null, pluginName: string | null): RemedyLink | null {
  if (!remedy) return null
  const t = messages().errorHelp
  if (remedy === 'connections') return { to: routePaths.connections, label: t.openConnections }
  if (!pluginName) return isPluginRemedy(remedy) ? { to: routePaths.plugins, label: t.openPlugins } : null
  const pluginLabel = humanizePluginName(pluginName)
  return remedy === 'pluginSettings'
    ? { to: pluginSettingsPath(pluginName), label: t.openPluginSettings(pluginLabel) }
    : { to: pluginDetailPath(pluginName), label: t.openPluginPage(pluginLabel) }
}

interface ErrorHelpNoticeProps {
  help: ErrorHelp
  /** The original message, shown under the explanation. */
  detail: string
  /** The plugin the error came from (technical name), for the button and the detail label. */
  pluginName?: string | null
  /** A line above the explanation ("Could not start the test"). */
  title?: string
  /** Replaces the kind's headline (a sentence that names the host, for example). */
  headline?: ReactNode
  /** False when the line above already says what went wrong (the run feed). */
  showsHeadline?: boolean
  /** Replaces the kind's next step where the screen knows a more exact one (a settings form). */
  nextStep?: string
  /** No remedy button, on the screen the remedy would open (a plugin's own settings). */
  hidesRemedy?: boolean
  /** Extra links next to the remedy button. */
  children?: ReactNode
  /** Without its own border and background, inside a box that already has them. */
  isBare?: boolean
  className?: string
}

/**
 * Shows an explained error with its original message.
 *
 * @example
 * const help = explainErrorKind('setup_required')
 * help && <ErrorHelpNotice help={help} detail="DOCUMENT_TEMPLATES_OUTPUT_DIR is not set" pluginName="document-templates" />
 */
export function ErrorHelpNotice({ help, detail, pluginName = null, title, headline, showsHeadline = true, nextStep, hidesRemedy = false, children, isBare = false, className }: ErrorHelpNoticeProps) {
  const t = messages().errorHelp
  const link = hidesRemedy ? null : remedyLink(help.remedy, pluginName)
  const detailLabel = pluginName ? t.messageFrom(humanizePluginName(pluginName)) : t.originalMessage
  return (
    <div
      role="alert"
      className={joinClassNames('flex flex-col gap-1.5', !isBare && 'rounded-lg border border-danger-line bg-danger-tint px-3 py-2', className)}
    >
      {title && <span className="font-semibold text-danger">{title}</span>}
      {showsHeadline && <span className="font-medium text-danger">{headline ?? help.headline}</span>}
      <span className="text-[13px] leading-normal text-body">{nextStep ?? help.nextStep}</span>
      {(link || children) && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {link && (
            <LinkButton to={link.to} variant="secondary" size="sm">
              {link.label}
            </LinkButton>
          )}
          {children}
        </div>
      )}
      {detail && (
        <div className="flex flex-col gap-0.5 pt-0.5">
          <span className="text-[12px] font-medium text-muted">{detailLabel}</span>
          <p className="m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink-2">{detail}</p>
        </div>
      )}
    </div>
  )
}
