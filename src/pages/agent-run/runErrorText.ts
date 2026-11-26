import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'
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

const statusSentences: Readonly<Record<number, string>> = localizedRecord(() => messages().agentRun.httpStatus)

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
  if (statusCode >= 500) return messages().agentRun.serverProblem(host ?? messages().agentRun.theService, statusCode)
  return null
}

function describeKnownProblem(message: string, host: string | null): string | null {
  const target = host ?? messages().agentRun.theServer
  if (/dns error|failed to lookup address|nodename nor servname|name or service not known|getaddrinfo|ENOTFOUND|no such host/i.test(message)) {
    return messages().agentRun.cannotReach(target)
  }
  const t = messages().agentRun
  if (/connection refused|ECONNREFUSED/i.test(message)) return t.refusedConnection(host ?? t.theServerCapital)
  if (/timed out|timeout|deadline exceeded/i.test(message)) return t.tookTooLong(host ?? t.theService)
  if (/certificate|tls|ssl/i.test(message)) return t.noSecureConnection(target)
  if (/connection reset|broken pipe|network is unreachable|error sending request/i.test(message)) return t.couldNotConnect(target)
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
  const summary = describeKnownProblem(rawError, host) ?? capitalize(message || messages().agentRun.somethingWentWrong)
  return { summary, raw: rawError, itemIndex }
}
