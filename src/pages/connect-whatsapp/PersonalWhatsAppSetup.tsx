import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import { findInstalledPlugin, type PluginsState } from '@/hooks/usePlugins'
import { BrowserRuntimeCard } from '../connections/BrowserRuntimeCard'
import { PluginInstallStepBody, PluginTrustStepBody } from './PluginSetupParts'
import { SetupStep } from './SetupStep'
import { whatsAppWebPluginName } from './useWhatsAppActions'
import { WhatsAppWebLinkPanel } from './WhatsAppWebLinkPanel'

/** The plugin README's Terms of Service warning, shown before anything else. */
function TermsOfServiceWarning() {
  return (
    <section aria-labelledby="wa-personal-warning-h" className="flex flex-col gap-1.5 rounded-xl border-2 border-amber-line bg-amber-soft px-4 py-3.5 leading-normal text-amber-deep">
      <h3 id="wa-personal-warning-h" className="m-0 text-[14px] font-semibold text-amber-strong">
        Read this before linking a personal number
      </h3>
      <ul className="m-0 flex flex-col gap-1 pl-5 text-[13px]">
        <li>Automating a personal WhatsApp account breaks WhatsApp's Terms of Service.</li>
        <li>High volume or spam-like patterns can get your number banned.</li>
        <li>For low-volume personal use only. Sends are rate limited and never retried.</li>
        <li>For business messaging, use the official Cloud API (WhatsApp Business option above).</li>
      </ul>
    </section>
  )
}

interface PersonalWhatsAppSetupProps {
  plugins: PluginsState
  browserRuntime: BrowserRuntimeState
}

/**
 * Screen 05, "Personal WhatsApp (QR)": the Terms of Service warning, then install and trust
 * `whatsapp-web`, install the browser runtime if needed, and link with the QR code.
 */
export function PersonalWhatsAppSetup({ plugins, browserRuntime }: PersonalWhatsAppSetupProps) {
  const installedPlugin = findInstalledPlugin(plugins.data, whatsAppWebPluginName)
  const isTrusted = installedPlugin?.trusted ?? false
  const hasBrowserRuntime = browserRuntime.status === 'installed'

  return (
    <div className="flex flex-col gap-4">
      <TermsOfServiceWarning />
      <ol aria-label="Set up personal WhatsApp" className="m-0 flex list-none flex-col gap-4 p-0">
        <SetupStep number={1} title={`Install the ${whatsAppWebPluginName} plugin`} isDone={installedPlugin !== null}>
          <PluginInstallStepBody plugins={plugins} pluginName={whatsAppWebPluginName} />
        </SetupStep>
        <SetupStep number={2} title="Trust the plugin" isDone={isTrusted}>
          {installedPlugin && <PluginTrustStepBody plugins={plugins} installedPlugin={installedPlugin} />}
        </SetupStep>
        <SetupStep number={3} title="Install the browser runtime" isDone={hasBrowserRuntime}>
          {isTrusted && !hasBrowserRuntime && <BrowserRuntimeCard runtime={browserRuntime} />}
        </SetupStep>
        <SetupStep number={4} title="Link WhatsApp with the QR code" isDone={false}>
          {isTrusted && hasBrowserRuntime && <WhatsAppWebLinkPanel />}
        </SetupStep>
      </ol>
    </div>
  )
}
