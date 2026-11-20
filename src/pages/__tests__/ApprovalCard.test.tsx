import { fireEvent, render, screen } from '@testing-library/react'
import { readPendingApprovals } from '@/api/pauseReasons'
import type { PendingApproval } from '@/api/runReviewTypes'
import type { Run } from '@/api/types'
import { ApprovalCard } from '@/pages/agent-run/ApprovalCard'
import { describeDeadline, describeTimeLeft } from '@/pages/agent-run/approvalDisplay'
import { buildApprovalAnswer, collectAnswersByResumeKey } from '@/pages/agent-run/approvalForm'
import { readPauseDeadline, readPauseQuestion } from '@/pages/agent-run/runPauseQuestion'

/** Approval cards for agent tool calls and for approval steps with a time limit. */

function buildPausedRun(pauseReasons: Run['pauseReasons']): Run {
  return {
    id: 'run-1',
    agentId: 'leads',
    agentVersion: 1,
    trigger: 'test',
    status: 'paused',
    startedAt: '2026-11-21T08:00:00Z',
    finishedAt: null,
    outputs: null,
    errorMessage: null,
    pauseReasons,
  }
}

const toolApprovalRun = buildPausedRun([
  {
    frame: '',
    node_id: 'find_leads',
    kind: 'tool_approval',
    data: {
      calls: [
        { id: 'c1', name: 'send_message', provider: 'whatsapp-web', tool: 'send_message', arguments: { phone: '+62 812', text: 'Halo!', api_key: 'abc' } },
        { id: 'c2', name: 'send_file', arguments: { path: '/tmp/menu.pdf', headers: { Authorization: 'Bearer zzz' } } },
      ],
    },
  },
])

function readFirstApproval(run: Run): PendingApproval {
  const [approval] = readPendingApprovals(run)
  if (!approval) throw new Error('expected a pending approval')
  return approval
}

describe('tool call approvals', () => {
  it('reads one Allow / Decline question per tool call, with secrets hidden', () => {
    const approvals = readPendingApprovals(toolApprovalRun)
    expect(approvals.map((approval) => approval.id)).toEqual(['find_leads#c1', 'find_leads#c2'])
    expect(approvals.every((approval) => approval.kind === 'toolCall' && approval.resumeKey === 'find_leads')).toBe(true)
    expect(approvals[0].toolCall).toMatchObject({ callId: 'c1', provider: 'whatsapp-web', tool: 'send_message', arguments: { phone: '+62 812', text: 'Halo!', api_key: '[hidden]' } })
    expect(approvals[1].toolCall?.arguments).toEqual({ path: '/tmp/menu.pdf', headers: { Authorization: '[hidden]' } })
    expect(approvals[0].actions.map((action) => action.title)).toEqual(['Allow', 'Decline'])
    expect(readPauseQuestion(toolApprovalRun)).toBe('Wants to use 2 tools')
  })

  it('answers each call by id and merges the answers of one agent step', () => {
    const [first, second] = readPendingApprovals(toolApprovalRun)
    const firstAnswer = buildApprovalAnswer(first, 'allow', {})
    const secondAnswer = buildApprovalAnswer(second, 'decline', {})
    expect(firstAnswer).toEqual({ approvals: { c1: true } })
    expect(collectAnswersByResumeKey([[first, firstAnswer], [second, secondAnswer]])).toEqual({ find_leads: { approvals: { c1: true, c2: false } } })
  })

  it('shows the tool and its arguments as JSON and answers Allow or Decline', () => {
    const onAnswer = vi.fn()
    const approval = readFirstApproval(toolApprovalRun)
    render(<ApprovalCard approval={{ ...approval, stepTitle: 'Find and contact leads' }} onAnswer={onAnswer} />)

    expect(screen.getByRole('heading', { name: 'Allow send_message?' })).toBeInTheDocument()
    expect(screen.getByText('Find and contact leads wants to use this tool')).toBeInTheDocument()
    expect(screen.getByText('whatsapp-web › send_message')).toBeInTheDocument()
    const argumentsBlock = screen.getByLabelText('Tool arguments')
    expect(argumentsBlock).toHaveTextContent('"phone": "+62 812"')
    expect(argumentsBlock).toHaveTextContent('"api_key": "[hidden]"')
    expect(argumentsBlock).not.toHaveTextContent('abc')

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(onAnswer.mock.calls).toEqual([[{ approvals: { c1: true } }], [{ approvals: { c1: false } }]])
  })

  it("shows the agent's reason when the pause carries one", () => {
    const approval = readFirstApproval(
      buildPausedRun([{ frame: '', node_id: 'agent', kind: 'tool_approval', data: { calls: [{ id: 'c9', name: 'search', reason: 'To find cafes nearby', arguments: {} }] } }]),
    )
    render(<ApprovalCard approval={approval} onAnswer={vi.fn()} />)
    expect(screen.getByText('To find cafes nearby')).toBeInTheDocument()
    expect(screen.getByText('search')).toBeInTheDocument()
  })
})

describe('approval deadlines', () => {
  const now = Date.parse('2026-11-21T10:00:00Z')

  it('describes the time left', () => {
    expect(describeTimeLeft('2026-11-21T12:00:00Z', now)).toBe('Expires in 2h')
    expect(describeTimeLeft('2026-11-21T11:30:00Z', now)).toBe('Expires in 1h 30m')
    expect(describeTimeLeft('2026-11-21T10:45:00Z', now)).toBe('Expires in 45 min')
    expect(describeTimeLeft('2026-11-24T10:00:00Z', now)).toBe('Expires in 3d')
    expect(describeTimeLeft('2026-11-21T09:00:00Z', now)).toBe('Expiring now')
    expect(describeTimeLeft(null, now)).toBeNull()
  })

  it('shows the countdown and the timeout outcome on the card', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    try {
      const timedRun = buildPausedRun([
        {
          frame: '',
          node_id: 'ask',
          kind: 'human_input',
          expires_at: '2026-11-21T12:00:00Z',
          on_timeout: { kind: 'answer', action: 'skip' },
          data: { prompt: 'Send this message?', fields: [], actions: [{ id: 'send', title: 'Send' }, { id: 'skip', title: 'Skip' }], timeout_ms: null },
        },
      ])
      const approval = readFirstApproval(timedRun)
      expect(approval.onTimeout).toEqual({ kind: 'answer', action: 'skip' })
      render(<ApprovalCard approval={approval} onAnswer={vi.fn()} />)
      expect(screen.getByText('Expires in 2h, then Skip')).toBeInTheDocument()
      expect(readPauseDeadline(timedRun, now)).toBe('Expires in 2h')
    } finally {
      vi.useRealTimers()
    }
  })

  it('says the run stops when the step has no timeout button', () => {
    const approval = readFirstApproval(
      buildPausedRun([{ frame: '', node_id: 'ask', kind: 'human_input', expires_at: '2026-11-21T10:20:00Z', on_timeout: { kind: 'stop' }, data: { prompt: 'Go?' } }]),
    )
    expect(describeDeadline(approval, now)).toBe('Expires in 20 min, then the run stops')
    const forever = readFirstApproval(buildPausedRun([{ frame: '', node_id: 'ask', kind: 'human_input', data: { prompt: 'Go?' } }]))
    expect(describeDeadline(forever, now)).toBeNull()
  })
})
