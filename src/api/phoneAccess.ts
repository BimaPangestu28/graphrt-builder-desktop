import { callBackend, isDesktopApp, listenToBackend } from './client'
import type { PhoneAccessSettings, PhoneAccessStatus, PhoneActivity } from './phoneAccessTypes'
import { samplePhoneAccessBackend, subscribeToSamplePhoneAccess } from './sampleBackend/phoneAccess'

/**
 * Settings > Phone access (see `src-tauri/src/phone_access`). Phones of this computer are paired
 * and removed with the pairing functions of `./deploy` and the target `{ kind: 'computer' }`.
 * Sample data outside the desktop app.
 */

const useSample = () => __SAMPLE_BACKEND__ && !isDesktopApp()

/** The Tauri event sent when a phone paired, was removed or answered a request. */
const PHONE_ACCESS_EVENT = 'phone-access-changed'

export function getPhoneAccessStatus(): Promise<PhoneAccessStatus> {
  return useSample() ? samplePhoneAccessBackend.status() : callBackend('phone_access_status')
}

export function savePhoneAccess(settings: PhoneAccessSettings): Promise<PhoneAccessStatus> {
  return useSample() ? samplePhoneAccessBackend.save(settings) : callBackend('save_phone_access', { settings })
}

export function listPhoneActivity(limit = 10): Promise<PhoneActivity[]> {
  return useSample() ? samplePhoneAccessBackend.activity(limit) : callBackend('phone_access_activity', { limit })
}

/**
 * Calls `onChange` whenever paired phones or their activity changed.
 *
 * @returns A function that stops listening
 */
export async function onPhoneAccessChanged(onChange: () => void): Promise<() => void> {
  if (useSample()) return subscribeToSamplePhoneAccess(onChange)
  return listenToBackend<null>(PHONE_ACCESS_EVENT, () => onChange())
}
