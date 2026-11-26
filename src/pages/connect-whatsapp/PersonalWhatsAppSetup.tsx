import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import { findInstalledPlugin, findInventoryDisplayName, type PluginsState } from '@/hooks/usePlugins'
import { BrowserRuntimeCard } from '../plugins/BrowserRuntimeCard'
import { PluginInstallStepBody, PluginTrustStepBody } from './PluginSetupParts'
import { SetupStep } from './SetupStep'
import { whatsAppWebPluginName } from './useWhatsAppActions'
import { WhatsAppWebLinkPanel } from './WhatsAppWebLinkPanel'
import { messages } from '@/i18n'

/** The plugin README's Terms of Service warning, shown before anything else. */
function TermsOfServiceWarning() {
  return (
    <section aria-labelledby="wa-personal-warning-h" className="flex flex-col gap-1.5 rounded-xl border-2 border-amber-line bg-amber-soft px-4 py-3.5 leading-normal text-amber-deep">
      <h3 id="wa-personal-warning-h" className="m-0 text-[14px] font-semibold text-amber-strong">
        {messages().chatbot.readThisBeforeLinkingAPersonal}
      </h3>
      <ul className="m-0 flex flex-col gap-1 pl-5 text-[13px]">
        <li>{messages().chatbot.automatingAPersonalWhatsappAccountBreaks}</li>
        <li>{messages().chatbot.highVolumeOrSpamLikePatterns}</li>
        <li>{messages().chatbot.forLowVolumePersonalUseOnly}</li>
        <li>{messages().chatbot.forBusinessMessagingUseTheOfficial}</li>
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
      <ol aria-label={messages().chatbot.setUpPersonalWhatsapp} className="m-0 flex list-none flex-col gap-4 p-0">
        <SetupStep number={1} title={messages().chatbot.installTheInventorydisplaynamePlugin(findInventoryDisplayName(plugins.data, whatsAppWebPluginName))} isDone={installedPlugin !== null}>
          <PluginInstallStepBody plugins={plugins} pluginName={whatsAppWebPluginName} />
        </SetupStep>
        <SetupStep number={2} title={messages().chatbot.trustThePlugin} isDone={isTrusted}>
          {installedPlugin && <PluginTrustStepBody plugins={plugins} installedPlugin={installedPlugin} />}
        </SetupStep>
        <SetupStep number={3} title={messages().chatbot.installTheBrowserRuntime} isDone={hasBrowserRuntime}>
          {isTrusted && !hasBrowserRuntime && <BrowserRuntimeCard runtime={browserRuntime} />}
        </SetupStep>
        <SetupStep number={4} title={messages().chatbot.linkWhatsappWithTheQrCode} isDone={false}>
          {isTrusted && hasBrowserRuntime && <WhatsAppWebLinkPanel />}
        </SetupStep>
      </ol>
    </div>
  )
}
