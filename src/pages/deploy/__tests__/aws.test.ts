import type { DeployProblem } from '@/api/deployTypes'
import { awsRegionLabel, describeAwsProblem, graphrtAwsPolicy, nearestAwsRegion } from '../aws'
import { describeDeployProblem } from '../googleCloud'

function problem(changes: Partial<DeployProblem>): DeployProblem {
  return { provider: 'aws', kind: 'aws_api', message: 'AWS said no', technical: 'ValidationException', project: 'ap-southeast-3', service: null, role: null, fix: null, ...changes }
}

describe('aws', () => {
  it('suggests the region closest to the time zone, Jakarta otherwise', () => {
    expect(nearestAwsRegion('Asia/Jakarta')).toBe('ap-southeast-3')
    expect(nearestAwsRegion('Asia/Singapore')).toBe('ap-southeast-1')
    expect(nearestAwsRegion('Europe/Dublin')).toBe('eu-west-1')
    expect(nearestAwsRegion('Europe/Berlin')).toBe('eu-central-1')
    expect(nearestAwsRegion('America/Los_Angeles')).toBe('us-west-2')
    expect(nearestAwsRegion('America/Chicago')).toBe('us-east-1')
    expect(nearestAwsRegion('UTC')).toBe('ap-southeast-3')
    expect(awsRegionLabel('ap-southeast-3')).toBe('Jakarta, Indonesia (ap-southeast-3)')
    expect(awsRegionLabel('me-south-1')).toBe('me-south-1')
  })

  it('shows the minimum policy limited to graphrt- resources', () => {
    const resources = graphrtAwsPolicy.Statement.map((statement) => statement.Resource)
    expect(resources.filter((resource) => resource !== '*').every((resource) => resource.includes('graphrt-'))).toBe(true)
    expect(graphrtAwsPolicy.Statement.find((statement) => statement.Resource === '*')?.Action).toBe('ecr:GetAuthorizationToken')
  })

  it('words the refusals people can fix and names the fix', () => {
    const denied = describeDeployProblem(problem({ kind: 'permission_denied', role: 'lambda:CreateFunction', fix: { kind: 'open_page', url: 'https://console.aws.amazon.com/iam/home#/users' } }))
    expect(denied.text).toMatch(/may not do this \(lambda:CreateFunction\)/)
    expect(denied.fixLabel).toBe('Open IAM users')
    const key = describeAwsProblem(problem({ kind: 'unauthorized', fix: { kind: 'connect_again', provider: 'aws' } }))
    expect(key).toEqual({ text: expect.stringMatching(/didn’t accept the access key/), fixLabel: 'Connect AWS again' })
    expect(describeAwsProblem(problem({}))).toEqual({ text: 'AWS said no', fixLabel: null })
  })
})
