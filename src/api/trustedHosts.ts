import { callBackend, isDesktopApp } from './client'
import { sampleTrustedHostsBackend } from './sampleBackend/trustedHosts'

/**
 * The sites an agent trusts for read-only lookups: a GET without a body to one of them runs
 * without asking, even when it carries values from the run. Stored per agent in the app,
 * never in the workflow document, so only the user adds them (these calls). Sample data
 * outside the desktop app.
 *
 * Entries look like `api.example.com`, `*.example.com` (its subdomains) or `api.example.com:8443`.
 */

type TrustedHostsListener = (agentId: string, hosts: string[]) => void

const listeners = new Set<TrustedHostsListener>()

/**
 * Calls `listener` after any add or remove made through this module, so every view of an
 * agent's hosts (Builder, Nodes view, chatbot setup) shows the same list.
 *
 * @returns Unsubscribe (() => void)
 */
export function subscribeToTrustedHostChanges(listener: TrustedHostsListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function announce(agentId: string, hosts: string[]): string[] {
  listeners.forEach((listener) => listener(agentId, hosts))
  return hosts
}

/** The agent's trusted hosts, in the order they were added. */
export function listTrustedLookupHosts(agentId: string): Promise<string[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTrustedHostsBackend.listTrustedLookupHosts(agentId)
  return callBackend('list_trusted_lookup_hosts', { agentId })
}

/**
 * Trusts `host` for the agent's read-only lookups; returns the new list.
 *
 * @throws BackendError - `invalid_input` with a plain reason for a host it cannot use
 */
export async function addTrustedLookupHost(agentId: string, host: string): Promise<string[]> {
  const hosts =
    __SAMPLE_BACKEND__ && !isDesktopApp() ? await sampleTrustedHostsBackend.addTrustedLookupHost(agentId, host) : await callBackend<string[]>('add_trusted_lookup_host', { agentId, host })
  return announce(agentId, hosts)
}

/** Stops trusting `host` for the agent's lookups; returns the new list. */
export async function removeTrustedLookupHost(agentId: string, host: string): Promise<string[]> {
  const hosts =
    __SAMPLE_BACKEND__ && !isDesktopApp()
      ? await sampleTrustedHostsBackend.removeTrustedLookupHost(agentId, host)
      : await callBackend<string[]>('remove_trusted_lookup_host', { agentId, host })
  return announce(agentId, hosts)
}
