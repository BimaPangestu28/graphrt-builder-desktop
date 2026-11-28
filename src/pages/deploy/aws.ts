import type { DeployProblem } from '@/api/deployTypes'
import { messages } from '@/i18n'

/** AWS for "Put it online": the regions offered, the minimum IAM policy and plain words for Lambda's refusals. */

/** The AWS regions offered, Asia first (the backend accepts any region code). */
export const awsRegions = ['ap-southeast-3', 'ap-southeast-1', 'ap-northeast-1', 'ap-south-1', 'ap-southeast-2', 'eu-central-1', 'eu-west-1', 'us-east-1', 'us-west-2'] as const

export type AwsRegion = (typeof awsRegions)[number]

/** The region of a first deploy: Jakarta, unless the computer's time zone is closer to another. */
export const defaultAwsRegion: AwsRegion = 'ap-southeast-3'

const regionsByTimeZone: ReadonlyArray<[RegExp, AwsRegion]> = [
  [/^Asia\/(Jakarta|Pontianak|Makassar|Jayapura)$/, 'ap-southeast-3'],
  [/^Asia\/(Singapore|Kuala_Lumpur|Kuching|Bangkok|Ho_Chi_Minh|Saigon|Manila|Phnom_Penh|Vientiane|Yangon|Brunei|Dili)$/, 'ap-southeast-1'],
  [/^Asia\/(Tokyo|Seoul|Pyongyang|Taipei|Hong_Kong|Macau|Shanghai)$/, 'ap-northeast-1'],
  [/^Asia\/(Kolkata|Calcutta|Dhaka|Karachi|Colombo|Kathmandu)$/, 'ap-south-1'],
  [/^(Australia|Pacific)\//, 'ap-southeast-2'],
  [/^Europe\/(London|Dublin|Lisbon)$/, 'eu-west-1'],
  [/^(Europe|Africa)\//, 'eu-central-1'],
  [/^America\/(Los_Angeles|Vancouver|Phoenix|Denver|Tijuana)$/, 'us-west-2'],
  [/^America\//, 'us-east-1'],
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
 * nearestAwsRegion('Asia/Singapore') // 'ap-southeast-1'
 */
export function nearestAwsRegion(timeZone: string | undefined = currentTimeZone()): AwsRegion {
  if (!timeZone) return defaultAwsRegion
  return regionsByTimeZone.find(([pattern]) => pattern.test(timeZone))?.[1] ?? defaultAwsRegion
}

/** "Jakarta, Indonesia (ap-southeast-3)"; the code alone for a region not in the list. */
export function awsRegionLabel(region: string): string {
  const name = (messages().deploy.aws.regions as Readonly<Record<string, string>>)[region]
  return name ? `${name} (${region})` : region
}

/**
 * The smallest IAM policy a deploying user needs (graphrt `docs/deploy-direct-aws.md`, IAM policy):
 * only resources named `graphrt-*`.
 */
export const graphrtAwsPolicy = {
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GraphrtLambda",
      "Effect": "Allow",
      "Action": [
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:CreateFunction",
        "lambda:UpdateFunctionConfiguration",
        "lambda:UpdateFunctionCode",
        "lambda:PublishVersion",
        "lambda:ListVersionsByFunction",
        "lambda:DeleteFunction",
        "lambda:TagResource",
        "lambda:GetAlias",
        "lambda:CreateAlias",
        "lambda:UpdateAlias",
        "lambda:GetFunctionUrlConfig",
        "lambda:CreateFunctionUrlConfig",
        "lambda:AddPermission",
        "lambda:InvokeFunction",
        "lambda:GetFunctionConcurrency",
        "lambda:PutFunctionConcurrency",
        "lambda:DeleteFunctionConcurrency"
      ],
      "Resource": "arn:aws:lambda:*:*:function:graphrt-*"
    },
    {
      "Sid": "GraphrtImages",
      "Effect": "Allow",
      "Action": [
        "ecr:CreateRepository",
        "ecr:DeleteRepository",
        "ecr:TagResource",
        "ecr:BatchCheckLayerAvailability",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchDeleteImage",
        "ecr:GetRepositoryPolicy",
        "ecr:SetRepositoryPolicy"
      ],
      "Resource": "arn:aws:ecr:*:*:repository/graphrt-*"
    },
    {
      "Sid": "GraphrtRegistryLogin",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "GraphrtRole",
      "Effect": "Allow",
      "Action": [
        "iam:GetRole",
        "iam:CreateRole",
        "iam:TagRole",
        "iam:ListRoleTags",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy"
      ],
      "Resource": "arn:aws:iam::*:role/graphrt-*"
    },
    {
      "Sid": "GraphrtPassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::*:role/graphrt-*",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "lambda.amazonaws.com"
        }
      }
    },
    {
      "Sid": "GraphrtLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:PutRetentionPolicy",
        "logs:DeleteLogGroup",
        "logs:TagResource"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/lambda/graphrt-*"
    }
  ]
}

/** The policy as people paste it into the AWS console. */
export const graphrtAwsPolicyText = JSON.stringify(graphrtAwsPolicy, null, 2)

/** What to tell the person about a refusal of AWS, in the UI language when its kind is known. */
export function describeAwsProblem(problem: DeployProblem): { text: string; fixLabel: string | null } {
  const words = messages().deploy.aws
  const texts: Record<string, () => string> = {
    unauthorized: () => words.problems.unauthorized,
    missing_credentials: () => words.problems.unauthorized,
    permission_denied: () => words.problems.permission_denied(problem.role ?? ''),
    account_not_ready: () => words.problems.account_not_ready,
    quota_exceeded: () => words.problems.quota_exceeded,
    region_unavailable: () => words.problems.region_unavailable(problem.project ?? ''),
    rate_limited: () => words.problems.rate_limited,
    aws_unavailable: () => words.problems.aws_unavailable,
    health_check_failed: () => messages().deploy.googleCloud.problems.health_check_failed,
    image_not_found: () => messages().deploy.googleCloud.problems.image_not_found,
  }
  const wording = texts[problem.kind]
  const text = wording ? wording() : problem.message
  if (!problem.fix) return { text, fixLabel: null }
  if (problem.fix.kind === 'connect_again') return { text, fixLabel: words.fixes.connectAgain }
  const fixLabels: Readonly<Record<string, string>> = words.fixes
  return { text, fixLabel: fixLabels[problem.kind] ?? words.fixes.other }
}
