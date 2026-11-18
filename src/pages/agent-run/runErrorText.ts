/**
 * Turns graphrt / HTTP client error text into a plain sentence for the run screens. The raw text
 * stays available (shown under "Technical details").
 */

export interface HumanizedRunError {
  /** Plain sentence, e.g. "Could not reach api.example.com: that address doesn't exist". */
  summary: string
  /** The error as graphrt reported it. */
  raw: string
  /** 0-based iteration item the error came from ("iteration item 0 failed: …"), if any. */
  itemIndex: number | null
}

const itemPrefixPattern = /iteration item (\d+) failed:\s*/i
const loopPrefixPattern = /loop round (\d+) failed:\s*/i
/** graphrt error-type prefixes such as "connection: " or "http: ". */
const typePrefixPattern = /^(?:[a-z_]+:\s+)+/i
const urlHostPattern = /https?:\/\/([^/\s:?#'"]+)/i
const bareHostPattern = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i

const statusSentences: Record<number, string> = {
  400: 'The service did not accept the request (400). A field it needs may be missing or wrong',
  401: 'The service rejected the sign-in (401). Check the API key or connection for this step',
  403: 'The service refused access (403). The account may not have permission for this',
  404: 'The address was not found (404). The URL or the item it points to may be wrong',
  408: 'The service took too long to answer (408)',
  429: 'The service is getting too many requests (429). Try again in a minute',
}

/**
 * Finds the host an error is about: from the error's own URL, else from the step's detail
 * ("POST api.example.com").
 */
export function extractErrorHost(rawError: string, stepDetail: string | null = null): string | null {
  const fromError = urlHostPattern.exec(rawError)?.[1]
  if (fromError) return fromError
  if (!stepDetail) return null
  return urlHostPattern.exec(stepDetail)?.[1] ?? bareHostPattern.exec(stepDetail)?.[1] ?? null
}

function readStatusCode(text: string): number | null {
  const match = /(?:status(?: code)?|http|returned|responded with)\D{0,12}([1-5]\d\d)\b/i.exec(text)
  return match ? Number(match[1]) : null
}

function describeStatus(statusCode: number, host: string | null): string | null {
  if (statusSentences[statusCode]) return statusSentences[statusCode]
  if (statusCode >= 500) return `${host ?? 'The service'} had a problem on its side (${statusCode}). Try again later`
  return null
}

function describeKnownProblem(message: string, host: string | null): string | null {
  const target = host ?? 'the server'
  if (/dns error|failed to lookup address|nodename nor servname|name or service not known|getaddrinfo|ENOTFOUND|no such host/i.test(message)) {
    return `Could not reach ${target}: that address doesn't exist`
  }
  if (/connection refused|ECONNREFUSED/i.test(message)) return `${host ?? 'The server'} refused the connection. Is the service running?`
  if (/timed out|timeout|deadline exceeded/i.test(message)) return `${host ?? 'The service'} took too long to answer`
  if (/certificate|tls|ssl/i.test(message)) return `Could not make a secure connection to ${target}`
  if (/connection reset|broken pipe|network is unreachable|error sending request/i.test(message)) return `Could not connect to ${target}`
  const statusCode = readStatusCode(message)
  return statusCode === null ? null : describeStatus(statusCode, host)
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Explains a run error in plain words.
 *
 * @param rawError - The error text from `node_failed` / `run_failed` (string)
 * @param stepDetail - The failing step's flow-summary detail, used to name the host (string | null)
 * @returns The sentence, the raw text and the iteration item it came from (HumanizedRunError)
 *
 * @example
 * humanizeRunError('connection: iteration item 0 failed: error sending request: dns error: failed to lookup address information', 'POST promo.example.com')
 * // { summary: "Could not reach promo.example.com: that address doesn't exist", itemIndex: 0, raw: … }
 */
export function humanizeRunError(rawError: string, stepDetail: string | null = null): HumanizedRunError {
  const itemMatch = itemPrefixPattern.exec(rawError) ?? loopPrefixPattern.exec(rawError)
  const itemIndex = itemMatch ? Number(itemMatch[1]) : null
  const message = rawError.replace(itemPrefixPattern, '').replace(loopPrefixPattern, '').replace(typePrefixPattern, '').trim()
  const host = extractErrorHost(rawError, stepDetail)
  const summary = describeKnownProblem(rawError, host) ?? capitalize(message || 'Something went wrong')
  return { summary, raw: rawError, itemIndex }
}
