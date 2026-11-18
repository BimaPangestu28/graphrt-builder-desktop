import { BackendError } from '../../client'
import type { PluginEvent } from '../../pluginTypes'
import { resetSamplePlugins, samplePluginsBackend, setSampleBrowserRuntimeStatus, subscribeToSampleBrowserRuntimeEvents, subscribeToSamplePluginEvents } from '../plugins'

async function expectBackendError(promise: Promise<unknown>, code: BackendError['code']) {
  await expect(promise).rejects.toBeInstanceOf(BackendError)
  await expect(promise).rejects.toMatchObject({ code })
}

async function readInstalled(name: string) {
  return (await samplePluginsBackend.listInstalledPlugins()).find((installedPlugin) => installedPlugin.name === name)
}

async function installTrusted(name: string) {
  await samplePluginsBackend.installPlugin(name)
  await samplePluginsBackend.setPluginTrusted(name, true)
}

describe('sample plugins backend', () => {
  beforeEach(() => resetSamplePlugins())

  it('starts with the two installed plugins of the Connections mock', async () => {
    const installedPlugins = await samplePluginsBackend.listInstalledPlugins()
    expect(installedPlugins.map((installedPlugin) => installedPlugin.name)).toEqual(['google-maps-scraper', 'website-check'])
    const catalog = await samplePluginsBackend.listPluginCatalog(false)
    expect(catalog.plugins.map((entry) => entry.name)).toEqual(['whatsapp-api', 'whatsapp-web', 'google-maps-scraper', 'website-check'])
    expect(catalog.plugins.find((entry) => entry.name === 'google-maps-scraper')).toMatchObject({ installedVersion: '1.0.0', updateAvailable: true })
    expect(catalog.plugins.find((entry) => entry.name === 'whatsapp-api')).toMatchObject({
      installedVersion: null,
      needsBrowser: false,
      permissions: { network: true, secrets: true, env: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_GRAPH_VERSION'] },
    })
  })

  it('installs untrusted with progress events, updates and removes', async () => {
    const pluginEvents: PluginEvent[] = []
    const unsubscribe = subscribeToSamplePluginEvents((pluginEvent) => pluginEvents.push(pluginEvent))
    const installedPlugin = await samplePluginsBackend.installPlugin('whatsapp-api')
    unsubscribe()
    expect(installedPlugin).toMatchObject({ name: 'whatsapp-api', version: '0.3.0', trusted: false })
    expect(installedPlugin.config.every((setting) => !setting.configured)).toBe(true)
    expect(pluginEvents.map((pluginEvent) => (pluginEvent.type === 'install_progress' ? pluginEvent.stage : pluginEvent.type))).toEqual([
      'downloading',
      'verifying',
      'extracting',
      'loading',
      'done',
      'plugins_changed',
    ])
    await expectBackendError(samplePluginsBackend.installPlugin('whatsapp-api'), 'invalid_input')
    await expectBackendError(samplePluginsBackend.installPlugin('nope'), 'not_found')

    expect((await samplePluginsBackend.updatePlugin('google-maps-scraper')).version).toBe('1.1.0')
    await expectBackendError(samplePluginsBackend.updatePlugin('google-maps-scraper'), 'invalid_input')

    await samplePluginsBackend.removePlugin('whatsapp-api')
    expect(await readInstalled('whatsapp-api')).toBeUndefined()
    await expectBackendError(samplePluginsBackend.removePlugin('whatsapp-api'), 'not_found')
  })

  it('toggles trust and flips configured without keeping values', async () => {
    await samplePluginsBackend.installPlugin('whatsapp-api')
    expect((await samplePluginsBackend.setPluginTrusted('whatsapp-api', true)).trusted).toBe(true)
    const configured = await samplePluginsBackend.setPluginConfig('whatsapp-api', 'WHATSAPP_ACCESS_TOKEN', '[ACCESS TOKEN]')
    expect(configured.config.find((setting) => setting.name === 'WHATSAPP_ACCESS_TOKEN')).toEqual({ name: 'WHATSAPP_ACCESS_TOKEN', configured: true })
    expect(JSON.stringify(configured)).not.toContain('[ACCESS TOKEN]')
    const cleared = await samplePluginsBackend.deletePluginConfig('whatsapp-api', 'WHATSAPP_ACCESS_TOKEN')
    expect(cleared.config.find((setting) => setting.name === 'WHATSAPP_ACCESS_TOKEN')?.configured).toBe(false)
    await expectBackendError(samplePluginsBackend.setPluginConfig('whatsapp-api', 'OTHER', 'x'), 'invalid_input')
    await expectBackendError(samplePluginsBackend.setPluginConfig('whatsapp-api', 'WHATSAPP_ACCESS_TOKEN', ' '), 'invalid_input')
    await expectBackendError(samplePluginsBackend.setPluginConfig('whatsapp-web', 'WHATSAPP_WEB_IDLE_MINUTES', '5'), 'not_found')
  })

  it('installs the browser runtime with progress events', async () => {
    const runtimeMessages: unknown[] = []
    const unsubscribe = subscribeToSampleBrowserRuntimeEvents((runtimeEvent) => runtimeMessages.push(runtimeEvent.message))
    expect(await samplePluginsBackend.getBrowserRuntimeStatus()).toBe('not_installed')
    await samplePluginsBackend.installBrowserRuntime()
    unsubscribe()
    expect(await samplePluginsBackend.getBrowserRuntimeStatus()).toBe('installed')
    expect(runtimeMessages).toEqual(['Downloading Chromium', 'Chromium is ready'])
  })

  it('runs only declared kinds of installed, trusted plugins', async () => {
    await expectBackendError(samplePluginsBackend.runPluginAction('whatsapp-api', 'whatsapp-api.get_business_profile', {}), 'invalid_input')
    await samplePluginsBackend.installPlugin('whatsapp-api')
    await expectBackendError(samplePluginsBackend.runPluginAction('whatsapp-api', 'whatsapp-api.get_business_profile', {}), 'invalid_input')
    await samplePluginsBackend.setPluginTrusted('whatsapp-api', true)
    await expectBackendError(samplePluginsBackend.runPluginAction('whatsapp-api', 'whatsapp-api.delete_everything', {}), 'invalid_input')
  })

  it('checks the business profile only with both WhatsApp API credentials', async () => {
    await installTrusted('whatsapp-api')
    await samplePluginsBackend.setPluginConfig('whatsapp-api', 'WHATSAPP_ACCESS_TOKEN', '[ACCESS TOKEN]')
    await expectBackendError(samplePluginsBackend.runPluginAction('whatsapp-api', 'whatsapp-api.get_business_profile', {}), 'workflow')
    await samplePluginsBackend.setPluginConfig('whatsapp-api', 'WHATSAPP_PHONE_NUMBER_ID', '[PHONE NUMBER ID]')
    const result = await samplePluginsBackend.runPluginAction('whatsapp-api', 'whatsapp-api.get_business_profile', {})
    expect(result.outputs.data).toMatchObject({ verified_name: '[BUSINESS NAME]' })
  })

  it('reports needs_login until whatsapp-web.login, and needs the browser runtime', async () => {
    await installTrusted('whatsapp-web')
    await expectBackendError(samplePluginsBackend.runPluginAction('whatsapp-web', 'whatsapp-web.get_status', {}), 'workflow')
    setSampleBrowserRuntimeStatus('installed')
    expect((await samplePluginsBackend.runPluginAction('whatsapp-web', 'whatsapp-web.get_status', {})).outputs.data).toMatchObject({ status: 'needs_login' })
    expect((await samplePluginsBackend.runPluginAction('whatsapp-web', 'whatsapp-web.login', { timeout_seconds: 180 })).outputs.data).toEqual({ status: 'logged_in' })
    expect((await samplePluginsBackend.runPluginAction('whatsapp-web', 'whatsapp-web.get_status', {})).outputs.data).toMatchObject({ status: 'logged_in' })
  })

  it('goes back to the seed state on reset', async () => {
    await samplePluginsBackend.removePlugin('website-check')
    setSampleBrowserRuntimeStatus('installed')
    resetSamplePlugins()
    expect(await readInstalled('website-check')).toBeDefined()
    expect(await samplePluginsBackend.getBrowserRuntimeStatus()).toBe('not_installed')
  })
})
