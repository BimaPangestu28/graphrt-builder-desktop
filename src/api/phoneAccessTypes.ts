/**
 * Settings > Phone access (`src-tauri/src/phone_access`): this computer serves the monitoring
 * page of its agents to paired phones.
 */

/** Where phones reach this computer. */
export type PhoneReach = { kind: 'lan' } | { kind: 'tailscale' } | { kind: 'tunnel'; publicUrl: string }

export interface PhoneAccessSettings {
  enabled: boolean
  reach: PhoneReach
  port: number
}

/** What Tailscale offers on this computer. */
export interface TailscaleInfo {
  installed: boolean
  running: boolean
  /** `laptop.tailnet-1234.ts.net`. */
  dnsName: string | null
  /** `100.x.y.z`. */
  address: string | null
  magicDns: boolean
  /** HTTPS certificates are on for the tailnet (HTTPS and notifications through Tailscale). */
  httpsCertificates: boolean
}

export interface PhoneAccessStatus {
  settings: PhoneAccessSettings
  /** Phones can connect right now. */
  serving: boolean
  /** The address phones open. */
  address: string | null
  /** Served over HTTPS: phones can get notifications. */
  secure: boolean
  /** Why it is not serving. */
  problem: string | null
  /** Something to know while it serves. */
  notice: string | null
  lanAddress: string | null
  tailscale: TailscaleInfo
  pairedCount: number
}

export type PhoneActivityKind = 'paired' | 'removed' | 'unpaired_itself' | 'answered' | 'pairing_refused'

/** One thing a paired phone did (or a refused pairing). */
export interface PhoneActivity {
  atMs: number
  kind: PhoneActivityKind
  deviceId: string | null
  deviceName: string | null
  runId: string | null
  agentName: string | null
}

export const defaultPhonePort = 47613
