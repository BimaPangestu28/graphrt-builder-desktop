/**
 * The builder proposes trusting a site for lookups with a line "Trust api.example.com for
 * lookups" in its reply (see `agent_builder/guides/trusted_lookups.md`). The chat shows each
 * proposal as a button; only the user's click trusts the site.
 */

const proposalPattern = /\btrust\s+`?((?:\*\.)?[a-z0-9.-]+(?::\d{1,5})?)`?\s+for\s+lookups\b/gi

/** A host as a trusted-host entry: a dotted name, optionally `*.` and `:port`. */
const hostShapePattern = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?(:\d{1,5})?$/

/**
 * The hosts a builder reply proposes to trust, lower-cased, in order, without duplicates.
 *
 * @param text - The builder's explanation (string)
 * @returns The proposed hosts (string[])
 *
 * @example
 * findTrustProposals('Added a lookup. Trust api.open-meteo.com for lookups.') // ['api.open-meteo.com']
 */
export function findTrustProposals(text: string): string[] {
  const hosts: string[] = []
  for (const match of text.matchAll(proposalPattern)) {
    const host = match[1].toLowerCase().replace(/\.$/, '')
    if (hostShapePattern.test(host) && !hosts.includes(host)) hosts.push(host)
  }
  return hosts
}
