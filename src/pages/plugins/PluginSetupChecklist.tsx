import type { ReactNode } from 'react'
import type { InstalledPlugin } from '@/api/pluginTypes'
import { Icon, VisuallyHidden, joinClassNames } from '@/components/ui'
import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import type { PluginRuntimeState } from '@/hooks/usePluginRuntime'
import type { PluginsState } from '@/hooks/usePlugins'
import { whatsAppWebPluginName } from '../connect-whatsapp/useWhatsAppActions'
import { BrowserRuntimeCard } from './BrowserRuntimeCard'
import { PluginRuntimeCard } from './PluginRuntimeCard'
import { PluginSettings } from './PluginSettings'
import { PluginTrustToggle } from './PluginTrustToggle'
import { WhatsAppWebLinkSection } from './WhatsAppWebLinkSection'

/** One numbered step of the setup checklist. `isDone: null` means graphrt cannot tell. */
export interface PluginSetupStep {
  id: string
  title: string
  /** Short state next to the title, e.g. "v0.2.1 on this computer". */
  summary?: string
  isDone: boolean | null
  content?: ReactNode
}

function StepMarker({ number, isDone }: { number: number; isDone: boolean | null }) {
  if (isDone) {
    return (
      <span aria-hidden="true" className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok-strong">
        <Icon name="check" size={13} strokeWidth={2.5} />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-line-heavy bg-surface text-[12px] font-semibold text-ink-2">
      {number}
    </span>
  )
}

/**
 * The setup steps as a numbered checklist: a marker per step (a check once it is done)
 * joined by a line, the step title with its state, then what to do for it.
 */
export function PluginSetupChecklist({ steps }: { steps: PluginSetupStep[] }) {
  return (
    <ol aria-label="Setup steps" className="m-0 flex list-none flex-col p-0">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1
        return (
          <li key={step.id} className="relative flex gap-3">
            {!isLast && <span aria-hidden="true" className="absolute top-6 bottom-0 left-3 w-px -translate-x-1/2 bg-line-strong" />}
            <StepMarker number={index + 1} isDone={step.isDone} />
            <div className={joinClassNames('flex min-w-0 flex-1 flex-col gap-2', !isLast && 'pb-5')}>
              <div className="flex min-h-6 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-0.5">
                <span className={joinClassNames('text-[14px] font-semibold', step.isDone ? 'text-ink-2' : 'text-ink')}>
                  {step.title}
                  {step.isDone && <VisuallyHidden> (done)</VisuallyHidden>}
                </span>
                {step.summary && <span className="text-[12px] text-muted">{step.summary}</span>}
              </div>
              {step.content}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function describeSettingsSummary(installed: InstalledPlugin): string {
  const required = installed.config.filter((setting) => !setting.optional)
  const optionalCount = installed.config.length - required.length
  if (required.length === 0) return optionalCount === 1 ? '1 optional, the default works' : `${optionalCount} optional, the defaults work`
  const setCount = required.filter((setting) => setting.configured).length
  return `${setCount} of ${required.length} required set`
}

interface BuildStepsInput {
  installed: InstalledPlugin
  plugins: PluginsState
  browserRuntime: BrowserRuntimeState
  pluginRuntime: PluginRuntimeState
}

/**
 * What a person does after installing, top to bottom: install (done), trust, the plugin
 * runtime (Node.js) while it is missing, the browser runtime when the plugin needs it, linking the account (whatsapp-web: QR code), then
 * settings with required ones first and optional ones folded.
 *
 * @returns The steps that apply to this plugin (PluginSetupStep[])
 */
export function buildPluginSetupSteps({ installed, plugins, browserRuntime, pluginRuntime }: BuildStepsInput): PluginSetupStep[] {
  const isBrowserReady = browserRuntime.status === 'installed'
  const steps: PluginSetupStep[] = [
    { id: 'install', title: 'Install', summary: `v${installed.version} on this computer`, isDone: true },
    {
      id: 'trust',
      title: 'Trust it',
      summary: installed.trusted ? 'Trusted' : 'Not trusted yet',
      isDone: installed.trusted,
      content: (
        <PluginTrustToggle
          pluginLabel={installed.displayName}
          isTrusted={installed.trusted}
          isSaving={plugins.operationByName[installed.name] === 'trusting'}
          onChange={(trusted) => void plugins.setTrusted(installed.name, trusted, installed.permissions)}
        />
      ),
    },
  ]
  if (installed.needsNodeRuntime && pluginRuntime.status !== 'installed') {
    steps.push({ id: 'runtime', title: 'Plugin runtime', isDone: false, content: <PluginRuntimeCard runtime={pluginRuntime} isEmbedded /> })
  }
  if (installed.needsBrowser) {
    steps.push({ id: 'browser', title: 'Browser runtime', isDone: isBrowserReady, content: <BrowserRuntimeCard runtime={browserRuntime} isEmbedded /> })
  }
  if (installed.name === whatsAppWebPluginName) {
    steps.push({ id: 'link', title: 'Link your account', isDone: null, content: <WhatsAppWebLinkSection installed={installed} isBrowserReady={isBrowserReady} /> })
  }
  if (installed.config.length > 0) {
    const isEveryRequiredSet = installed.config.every((setting) => setting.optional || setting.configured)
    const hasRequired = installed.config.some((setting) => !setting.optional)
    steps.push({
      id: 'settings',
      title: 'Settings',
      summary: describeSettingsSummary(installed),
      isDone: hasRequired ? isEveryRequiredSet : null,
      content: <PluginSettings installed={installed} plugins={plugins} />,
    })
  }
  return steps
}
