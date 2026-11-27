import { BackendError } from '../client'
import type { DevicePairing, PairedDevice } from '../deployTypes'
import { defaultPhonePort, type PhoneAccessSettings, type PhoneAccessStatus, type PhoneActivity } from '../phoneAccessTypes'
import { respondWith } from './sampleResponse'

/**
 * Phone access in the browser preview: nothing is served. Turning it on pretends the computer
 * is on a Wi-Fi network; a pairing code is shown, but no phone can use it here, so the list of
 * phones stays as it is.
 */

const sampleLanAddress = '192.168.1.21'

interface SamplePhoneAccessState {
  settings: PhoneAccessSettings
  devices: PairedDevice[]
  activity: PhoneActivity[]
  deviceNumber: number
}

function initialState(): SamplePhoneAccessState {
  return { settings: { enabled: false, reach: { kind: 'lan' }, port: defaultPhonePort }, devices: [], activity: [], deviceNumber: 0 }
}

let state = initialState()
const listeners = new Set<() => void>()

/** Starts the sample over (tests). */
export function resetSamplePhoneAccess(): void {
  state = initialState()
}

export function subscribeToSamplePhoneAccess(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

function changed(): void {
  for (const listener of listeners) listener()
}

function invalid(message: string): never {
  throw new BackendError('invalid_input', message)
}

function status(): PhoneAccessStatus {
  const { settings } = state
  const tailscale = { installed: false, running: false, dnsName: null, address: null, magicDns: false, httpsCertificates: false }
  const base = { settings, lanAddress: sampleLanAddress, tailscale, pairedCount: state.devices.length, notice: null }
  if (!settings.enabled) return { ...base, serving: false, address: null, secure: false, problem: null }
  switch (settings.reach.kind) {
    case 'lan':
      return { ...base, serving: true, address: `http://${sampleLanAddress}:${settings.port}`, secure: false, problem: null }
    case 'tailscale':
      return { ...base, serving: false, address: null, secure: false, problem: 'Tailscale is not installed on this computer. Install it from tailscale.com, sign in, and turn this on again.' }
    case 'tunnel':
      return { ...base, serving: true, address: settings.reach.publicUrl, secure: true, problem: null, notice: `Your tunnel must forward ${settings.reach.publicUrl} to http://127.0.0.1:${settings.port} on this computer.` }
  }
}

function save(settings: PhoneAccessSettings): PhoneAccessStatus {
  if (settings.reach.kind === 'tunnel') {
    let url: URL
    try {
      url = new URL(settings.reach.publicUrl.trim())
    } catch {
      invalid('enter your tunnel\'s address, like https://agents.example.com')
    }
    if (url.protocol !== 'https:' || (url.pathname !== '/' && url.pathname !== '')) invalid('enter your tunnel\'s address, like https://agents.example.com')
    state.settings = { ...settings, reach: { kind: 'tunnel', publicUrl: url.origin } }
  } else {
    state.settings = settings
  }
  changed()
  return status()
}

function pair(name: string): DevicePairing {
  const current = status()
  if (!current.serving || !current.address) invalid('Turn on Phone access first (Settings, Phone access)')
  const deviceName = name.trim()
  if (!deviceName || deviceName.length > 100) invalid('give the phone a name of up to 100 characters')
  state.deviceNumber += 1
  return { deviceId: `pairing-sample${state.deviceNumber}`, deviceName, link: `${current.address}/pair#grp1.sample-preview-only` }
}

/** A phone that paired with its code (tests and the preview's sample data). */
export function addSamplePairedPhone(name: string): PairedDevice {
  state.deviceNumber += 1
  const device = { id: `dev-sample${state.deviceNumber}`, name, pairedAtMs: Date.now(), lastUsedAtMs: null, canShowCode: false }
  state.devices = [...state.devices, device]
  state.activity = [{ atMs: Date.now(), kind: 'paired', deviceId: device.id, deviceName: name, runId: null, agentName: null }, ...state.activity]
  changed()
  return device
}

function revoke(deviceId: string): void {
  const device = state.devices.find((entry) => entry.id === deviceId)
  if (!device) return
  state.devices = state.devices.filter((entry) => entry.id !== deviceId)
  state.activity = [{ atMs: Date.now(), kind: 'removed', deviceId, deviceName: device.name, runId: null, agentName: null }, ...state.activity]
  changed()
}

export const samplePhoneAccessBackend = {
  status: () => respondWith(status),
  save: (settings: PhoneAccessSettings) => respondWith(() => save(settings)),
  activity: (limit: number) => respondWith(() => state.activity.slice(0, limit)),
  listDevices: () => respondWith(() => state.devices.map((device) => ({ ...device }))),
  pair: (name: string) => respondWith(() => pair(name)),
  revoke: (deviceId: string) => respondWith(() => revoke(deviceId)),
}
