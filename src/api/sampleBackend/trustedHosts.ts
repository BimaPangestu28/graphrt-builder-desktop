import { BackendError } from '../client'
import { respondWith } from './sampleResponse'

/**
 * Sample trusted lookup hosts for the browser preview and tests, kept in memory per agent.
 * Validates hosts like the desktop (`flow::trusted_hosts::normalize_trusted_host`), in
 * fewer words. Call {@link resetSampleTrustedHosts} in tests to start empty.
 */

const storedHosts = new Map<string, string[]>()

const hostPattern = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?(:\d{1,5})?$/

/** Forgets every sample agent's trusted hosts. */
export function resetSampleTrustedHosts(): void {
  storedHosts.clear()
}

function normalizeHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '')
  if (normalized.includes('://')) throw new BackendError('invalid_input', 'Enter only the site name, without http:// or https://')
  if (/[/?#@\s\\]/.test(normalized)) throw new BackendError('invalid_input', 'Enter only the site name, without a path or spaces')
  if (!hostPattern.test(normalized)) throw new BackendError('invalid_input', `\`${host.trim()}\` is not a site name such as api.example.com`)
  return normalized
}

function readHosts(agentId: string): string[] {
  return [...(storedHosts.get(agentId) ?? [])]
}

function addHost(agentId: string, host: string): string[] {
  const normalized = normalizeHost(host)
  const hosts = readHosts(agentId)
  if (!hosts.includes(normalized)) storedHosts.set(agentId, [...hosts, normalized])
  return readHosts(agentId)
}

function removeHost(agentId: string, host: string): string[] {
  const target = host.trim().toLowerCase()
  storedHosts.set(
    agentId,
    readHosts(agentId).filter((entry) => entry !== target),
  )
  return readHosts(agentId)
}

export const sampleTrustedHostsBackend = {
  listTrustedLookupHosts: (agentId: string): Promise<string[]> => respondWith(() => readHosts(agentId)),
  addTrustedLookupHost: (agentId: string, host: string): Promise<string[]> => respondWith(() => addHost(agentId, host)),
  removeTrustedLookupHost: (agentId: string, host: string): Promise<string[]> => respondWith(() => removeHost(agentId, host)),
}
