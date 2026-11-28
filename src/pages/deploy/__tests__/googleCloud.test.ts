import { BackendError } from '@/api/client'
import type { DeployProblem } from '@/api/deployTypes'
import { cloudRunRegionLabel, deployProblemOf, describeDeployProblem, nearestCloudRunRegion } from '../googleCloud'

function problem(changes: Partial<DeployProblem>): DeployProblem {
  return { provider: 'google_cloud', kind: 'gcp_api', message: 'Google said no', technical: 'HTTP 400', project: 'acme-agents', service: null, role: null, fix: null, ...changes }
}

describe('googleCloud', () => {
  it('suggests the region closest to the time zone, Jakarta otherwise', () => {
    expect(nearestCloudRunRegion('Asia/Jakarta')).toBe('asia-southeast2')
    expect(nearestCloudRunRegion('Asia/Makassar')).toBe('asia-southeast2')
    expect(nearestCloudRunRegion('Asia/Singapore')).toBe('asia-southeast1')
    expect(nearestCloudRunRegion('Europe/Berlin')).toBe('europe-west3')
    expect(nearestCloudRunRegion('Europe/Paris')).toBe('europe-west1')
    expect(nearestCloudRunRegion('America/Chicago')).toBe('us-central1')
    expect(nearestCloudRunRegion('UTC')).toBe('asia-southeast2')
    expect(nearestCloudRunRegion(undefined)).toBe('asia-southeast2')
    expect(cloudRunRegionLabel('asia-southeast2')).toBe('Jakarta, Indonesia (asia-southeast2)')
    expect(cloudRunRegionLabel('me-central1')).toBe('me-central1')
  })

  it('words the refusals people can fix and names the fix', () => {
    const billing = describeDeployProblem(problem({ kind: 'billing_disabled', fix: { kind: 'open_page', url: 'https://console.cloud.google.com/billing/linkedaccount?project=acme-agents' } }))
    expect(billing.text).toMatch(/Project acme-agents has no billing account/)
    expect(billing.fixLabel).toBe('Turn on billing')
    const api = describeDeployProblem(problem({ kind: 'api_disabled', service: 'run.googleapis.com', fix: { kind: 'open_page', url: 'https://console.cloud.google.com/apis/library/run.googleapis.com?project=acme-agents' } }))
    expect(api.text).toMatch(/^run\.googleapis\.com is turned off in project acme-agents/)
    expect(api.fixLabel).toBe('Turn it on')
    const denied = describeDeployProblem(problem({ kind: 'permission_denied', role: 'roles/run.admin', fix: { kind: 'open_page', url: 'https://console.cloud.google.com/iam-admin/iam?project=acme-agents' } }))
    expect(denied.text).toMatch(/roles\/run\.admin \(Owner\)/)
    expect(describeDeployProblem(problem({ kind: 'unauthorized', fix: { kind: 'sign_in_again' } })).fixLabel).toBe('Sign in with Google again')
    expect(describeDeployProblem(problem({}))).toEqual({ text: 'Google said no', fixLabel: null })
  })

  it('finds the problem inside a deploy_failed error only', () => {
    const details = problem({ kind: 'org_policy' })
    expect(deployProblemOf(new BackendError('deploy_failed', 'x', details))).toEqual(details)
    expect(deployProblemOf(new BackendError('internal', 'x'))).toBeNull()
    expect(deployProblemOf(new Error('x'))).toBeNull()
  })
})
