import { isBackendErrorWithCode } from '@/api/client'
import type { DeployProblem } from '@/api/deployTypes'
import { messages } from '@/i18n'
import { describeAwsProblem } from './aws'

/** Google Cloud for "Put it online": the Cloud Run regions offered and plain words for its refusals. */

/** The Cloud Run regions offered, Asia first (the backend accepts any region code). */
export const cloudRunRegions = ['asia-southeast2', 'asia-southeast1', 'asia-east1', 'asia-northeast1', 'asia-south1', 'australia-southeast1', 'europe-west1', 'europe-west3', 'us-central1', 'us-east1'] as const

export type CloudRunRegion = (typeof cloudRunRegions)[number]

/** The region of a first deploy: Jakarta, unless the computer's time zone is closer to another. */
export const defaultCloudRunRegion: CloudRunRegion = 'asia-southeast2'

const regionsByTimeZone: ReadonlyArray<[RegExp, CloudRunRegion]> = [
  [/^Asia\/(Jakarta|Pontianak|Makassar|Jayapura)$/, 'asia-southeast2'],
  [/^Asia\/(Singapore|Kuala_Lumpur|Kuching|Bangkok|Ho_Chi_Minh|Saigon|Manila|Phnom_Penh|Vientiane|Yangon|Brunei|Dili)$/, 'asia-southeast1'],
  [/^Asia\/(Taipei|Hong_Kong|Macau|Shanghai|Chongqing)$/, 'asia-east1'],
  [/^Asia\/(Tokyo|Seoul|Pyongyang)$/, 'asia-northeast1'],
  [/^Asia\/(Kolkata|Calcutta|Dhaka|Karachi|Colombo|Kathmandu)$/, 'asia-south1'],
  [/^(Australia|Pacific)\//, 'australia-southeast1'],
  [/^Europe\/Berlin$/, 'europe-west3'],
  [/^(Europe|Africa)\//, 'europe-west1'],
  [/^America\/(New_York|Toronto|Detroit|Montreal|Bogota|Lima|Sao_Paulo|Argentina)/, 'us-east1'],
  [/^America\//, 'us-central1'],
]

function currentTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/**
 * The offered region closest to a time zone, else Jakarta.
 *
 * @example
 * nearestCloudRunRegion('Asia/Singapore') // 'asia-southeast1'
 */
export function nearestCloudRunRegion(timeZone: string | undefined = currentTimeZone()): CloudRunRegion {
  if (!timeZone) return defaultCloudRunRegion
  return regionsByTimeZone.find(([pattern]) => pattern.test(timeZone))?.[1] ?? defaultCloudRunRegion
}

/** "Jakarta, Indonesia (asia-southeast2)"; the code alone for a region not in the list. */
export function cloudRunRegionLabel(region: string): string {
  const name = (messages().deploy.googleCloud.regions as Readonly<Record<string, string>>)[region]
  return name ? `${name} (${region})` : region
}

/** The explained refusal inside a backend error, or null. */
export function deployProblemOf(error: unknown): DeployProblem | null {
  return isBackendErrorWithCode(error, 'deploy_failed') ? error.details : null
}

/** What to tell the person: the problem in the UI language when its kind is known, else the backend's sentence. */
export function describeDeployProblem(problem: DeployProblem): { text: string; fixLabel: string | null } {
  if (problem.provider === 'aws') return describeAwsProblem(problem)
  const words = messages().deploy.googleCloud
  const project = problem.project ?? '—'
  const texts: Record<string, () => string> = {
    api_disabled: () => words.problems.api_disabled(problem.service ?? words.aService, project),
    billing_disabled: () => words.problems.billing_disabled(project),
    permission_denied: () => words.problems.permission_denied(problem.role ? `${problem.role} (${words.ownerRole})` : words.ownerRole, project),
    org_policy: () => words.problems.org_policy(project),
    unauthorized: () => words.problems.unauthorized,
    missing_credentials: () => words.problems.unauthorized,
    name_taken: () => words.problems.name_taken,
    rate_limited: () => words.problems.rate_limited,
    gcp_unavailable: () => words.problems.gcp_unavailable,
    health_check_failed: () => words.problems.health_check_failed,
    image_not_found: () => words.problems.image_not_found,
    start_timeout: () => words.problems.health_check_failed,
  }
  const wording = problem.provider === 'google_cloud' ? texts[problem.kind] : undefined
  const text = wording ? wording() : problem.message
  if (!problem.fix) return { text, fixLabel: null }
  if (problem.fix.kind === 'sign_in_again') return { text, fixLabel: words.fixes.signInAgain }
  const fixLabels: Readonly<Record<string, string>> = words.fixes
  return { text, fixLabel: fixLabels[problem.kind] ?? words.fixes.other }
}
