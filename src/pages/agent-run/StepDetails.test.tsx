import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { RunEventRecord } from '@/api/types'
import { setLocale } from '@/i18n'
import { agentPath, routePaths } from '@/routes'
import { buildRunStepViews, type RunStepView } from './runSteps'
import { StepDetails } from './StepDetails'

function event(seq: number, type: string, fields: Record<string, unknown> = {}): RunEventRecord {
  return { runId: 'run-1', seq, event: { type, node_id: 'helper', frame: '', ...fields }, createdAt: '2026-11-27T03:00:00Z' }
}

function progress(seq: number, name: string, data: unknown): RunEventRecord {
  return event(seq, 'node_progress', { name, data })
}

function helperStep(events: RunEventRecord[]): RunStepView {
  const steps = buildRunStepViews([{ id: 'helper', label: 'Answer the customer', nodeType: 'agent' }], [event(1, 'node_started', { kind: 'agent' }), ...events])
  return steps[0]
}

function renderDetails(step: RunStepView, agentId: string | null = 'support-desk') {
  return render(
    <MemoryRouter>
      <StepDetails step={step} id="details" agentId={agentId} />
    </MemoryRouter>,
  )
}

describe('what a step used from skills and learning', () => {
  it('counts the learned notes a step read, each once', () => {
    const step = helperStep([progress(2, 'lessons_applied', { agent: 'support-desk', ids: ['l1', 'l2'] }), progress(3, 'lessons_applied', { agent: 'support-desk', ids: ['l2', 'l3'] })])
    expect(step.learnedNoteCount).toBe(3)
    expect(helperStep([progress(2, 'lessons_applied', { agent: 'support-desk' }), progress(3, 'agent_step', { iteration: 1 })]).learnedNoteCount).toBe(0)
  })

  it('says how many notes were used and links to them', () => {
    renderDetails(helperStep([progress(2, 'lessons_applied', { agent: 'support-desk', ids: ['l1', 'l2'] })]))
    expect(screen.getByText(/Used 2 notes it learned\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the notes' })).toHaveAttribute('href', agentPath('learned', 'support-desk', { tab: 'inUse' }))
  })

  it('leaves the link out when the agent is not known', () => {
    renderDetails(helperStep([progress(2, 'lessons_applied', { agent: 'support-desk', ids: ['l1'] })]), null)
    expect(screen.getByText('Used 1 note it learned.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'See the notes' })).not.toBeInTheDocument()
  })

  it('names the tool a skill could not use, in plain words, once per skill and tool', () => {
    const missing = { skill: 'refund-policy', tool: 'whatsapp-api/send_message' }
    const step = helperStep([progress(2, 'skill_tool_unavailable', missing), progress(3, 'skill_tool_unavailable', missing), progress(4, 'skill_tool_unavailable', { skill: 'refund-policy', tool: 'gmail/*' }), progress(5, 'skill_tool_unavailable', { skill: 'refund-policy' })])
    expect(step.unavailableSkillTools).toEqual([missing, { skill: 'refund-policy', tool: 'gmail/*' }])
    renderDetails(step)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('A skill could not use everything you allowed')
    expect(note).toHaveTextContent('Refund Policy could not use WhatsApp API · Send message')
    expect(note).toHaveTextContent('Refund Policy could not use Gmail')
    expect(note).not.toHaveTextContent('whatsapp-api/send_message')
    expect(screen.getByRole('link', { name: 'Open Plugins' })).toHaveAttribute('href', routePaths.plugins)
  })

  it('shows nothing for a step that used neither', () => {
    renderDetails(helperStep([progress(2, 'agent_step', { iteration: 1 })]))
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(screen.queryByText(/it learned/)).not.toBeInTheDocument()
  })

  it('is translated', () => {
    setLocale('id')
    renderDetails(helperStep([progress(2, 'lessons_applied', { agent: 'support-desk', ids: ['l1', 'l2'] }), progress(3, 'skill_tool_unavailable', { skill: 'refund-policy', tool: 'gmail/send_email' })]))
    expect(screen.getByText(/Memakai 2 catatan yang dipelajari\./)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Refund Policy tidak bisa memakai Gmail · Send email')
  })
})

describe('a failed plugin step', () => {
  function invoiceStep(errorType: string | null, error: string): RunStepView {
    const steps = buildRunStepViews(
      [{ id: 'make_pdf', label: 'Make the invoice', nodeType: 'document-templates.render_pdf' }],
      [
        { runId: 'run-1', seq: 1, event: { type: 'node_started', node_id: 'make_pdf', frame: '', kind: 'document-templates.render_pdf' }, createdAt: '2026-11-27T03:00:00Z' },
        { runId: 'run-1', seq: 2, event: { type: 'node_failed', node_id: 'make_pdf', frame: '', error, error_type: errorType, handled: false }, createdAt: '2026-11-27T03:00:01Z' },
      ],
    )
    return steps[0]
  }

  it('explains the kind in Indonesian, links to the plugin settings and keeps the plugin message in view', () => {
    setLocale('id')
    const message = 'DOCUMENT_TEMPLATES_OUTPUT_DIR points to a folder that does not exist'
    const step = invoiceStep('setup_required', message)
    expect(step.errorType).toBe('setup_required')
    renderDetails(step)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Plugin ini belum selesai disiapkan')
    expect(alert).toHaveTextContent('Pesan dari Document Templates')
    expect(screen.getByText(message)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Buka pengaturan Document Templates' })).toHaveAttribute('href', '/plugins/document-templates?section=settings')
  })

  it('keeps the old explanation for an error without a known kind', () => {
    renderDetails(invoiceStep(null, 'something odd happened'))
    expect(screen.getByText('Something odd happened')).toBeInTheDocument()
    expect(screen.getByText('Technical details')).toBeInTheDocument()
  })
})
