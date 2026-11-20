import type { InstalledPlugin } from '@/api/pluginTypes'
import { Button } from '@/components/ui'
import { findInstalledPlugin, findInventoryDisplayName, type PluginsState } from '@/hooks/usePlugins'
import { PluginConfigForm, type PluginConfigField } from '../plugins/PluginConfigForm'
import { PluginInstallStepBody, PluginTrustStepBody } from './PluginSetupParts'
import { SetupStep } from './SetupStep'
import { useBusinessConnectionCheck, whatsAppApiPluginName } from './useWhatsAppActions'

/** The two settings screen 05 asks for; the others keep their defaults (on the whatsapp-api plugin page). */
const credentialFields = [
  { variable: 'WHATSAPP_ACCESS_TOKEN', label: 'Access token' },
  { variable: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Phone number ID' },
]

function listCredentialFields(installedPlugin: InstalledPlugin): PluginConfigField[] {
  return credentialFields.map((field) => ({
    ...field,
    configured: installedPlugin.config.some((setting) => setting.name === field.variable && setting.configured),
  }))
}

function ConnectionCheck() {
  const { isChecking, result, checkConnection } = useBusinessConnectionCheck()
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] text-body">Asks WhatsApp for your business profile with the token and phone number ID</span>
      <span>
        <Button size="sm" disabled={isChecking} onClick={() => void checkConnection()}>
          {isChecking ? 'Checking…' : 'Check connection'}
        </Button>
      </span>
      {result?.kind === 'connected' && (
        <p role="status" className="m-0 text-[13px] font-medium text-ok-strong">
          Connected to WhatsApp Business{result.businessName ? ` as ${result.businessName}` : ''}
        </p>
      )}
      {result?.kind === 'failed' && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not connect: {result.message}
        </p>
      )}
    </div>
  )
}

/**
 * Screen 05, "WhatsApp Business (official API)": install the `whatsapp-api` plugin, trust
 * it, save the access token and phone number ID, then check the connection.
 */
export function BusinessApiSetup({ plugins }: { plugins: PluginsState }) {
  const installedPlugin = findInstalledPlugin(plugins.data, whatsAppApiPluginName)
  const isTrusted = installedPlugin?.trusted ?? false
  const fields = installedPlugin ? listCredentialFields(installedPlugin) : []
  const hasCredentials = fields.length > 0 && fields.every((field) => field.configured)

  return (
    <ol aria-label="Set up WhatsApp Business" className="m-0 flex list-none flex-col gap-4 p-0">
      <SetupStep number={1} title={`Install the ${findInventoryDisplayName(plugins.data, whatsAppApiPluginName)} plugin`} isDone={installedPlugin !== null}>
        <PluginInstallStepBody plugins={plugins} pluginName={whatsAppApiPluginName} />
      </SetupStep>
      <SetupStep number={2} title="Trust the plugin" isDone={isTrusted}>
        {installedPlugin && <PluginTrustStepBody plugins={plugins} installedPlugin={installedPlugin} />}
      </SetupStep>
      <SetupStep number={3} title="Add your access token and phone number ID" isDone={hasCredentials}>
        {installedPlugin && isTrusted && (
          <>
            <span className="text-[13px] text-body">Find both in Meta for Developers under WhatsApp, API setup</span>
            <PluginConfigForm
              pluginLabel={findInventoryDisplayName(plugins.data, whatsAppApiPluginName)}
              fields={fields}
              onSave={(variable, value) => plugins.saveConfig(whatsAppApiPluginName, variable, value)}
              onClear={(variable) => plugins.clearConfig(whatsAppApiPluginName, variable)}
            />
          </>
        )}
      </SetupStep>
      <SetupStep number={4} title="Check the connection" isDone={false}>
        {isTrusted && hasCredentials && <ConnectionCheck />}
      </SetupStep>
    </ol>
  )
}
