import { AppShell } from '@/components/layout'
import { FailedRunPanel } from './error-states/FailedRunPanel'
import { OtherProblemsPanel } from './error-states/OtherProblemsPanel'

/**
 * Screen 23 · Error states.
 * A failed Morning email digest run explained in plain words, with Reconnect / Retry actions
 * that recover it, plus a column of other problems that follow the same "what happened,
 * what is safe, one fixing button" pattern.
 */
export function ErrorStatesPage() {
  return (
    <AppShell activeNav="runs" agents={{ kind: 'list' }} mainClassName="flex flex-wrap">
      <FailedRunPanel />
      <OtherProblemsPanel />
    </AppShell>
  )
}
