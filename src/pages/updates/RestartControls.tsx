import { Button } from '@/components/ui'
import { describeRunningRuns, type AppUpdateControls } from './updateContext'
import { messages } from '@/i18n'

interface RestartControlsProps {
  updateControls: AppUpdateControls
  /** Extra button shown next to "Restart to update" (the banner's "Later"). */
  onLater?: () => void
}

/**
 * "Restart to update", and the choice it leads to while agents run: restart now (the
 * runs stop) or restart by itself once they finish. Shared by the banner and Settings.
 */
export function RestartControls({ updateControls, onLater }: RestartControlsProps) {
  const { restartState, requestRestart, restartNow, restartWhenIdle, cancelRestart } = updateControls
  switch (restartState.kind) {
    case 'installing':
      return (
        <p role="status" className="m-0 text-[13px] text-body">
          {messages().misc.installingTheUpdate}
        </p>
      )
    case 'confirmingBusy':
      return (
        <div className="flex flex-col gap-2">
          <p role="alert" className="m-0 text-[13px] text-body">
            {describeRunningRuns(restartState.runningCount)}{messages().misc.restartingNowStops}{' '}{restartState.runningCount === 1 ? 'it' : 'them'}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={restartWhenIdle}>
              {messages().misc.restartWhenIdle}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void restartNow()}>
              {messages().misc.restartNow}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelRestart}>
              {messages().misc.cancel}
            </Button>
          </div>
        </div>
      )
    case 'waitingForIdle':
      return (
        <div className="flex flex-col gap-2">
          <p role="status" className="m-0 text-[13px] text-body">
            {messages().misc.graphrtRestartsWhenNoAgentIs}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void restartNow()}>
              {messages().misc.restartNow}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelRestart}>
              {messages().misc.cancel}
            </Button>
          </div>
        </div>
      )
    case 'none':
    case 'installFailed':
      return (
        <div className="flex flex-col gap-2">
          {restartState.kind === 'installFailed' && (
            <p role="alert" className="m-0 text-[13px] text-danger">
              {messages().misc.couldNotInstallTheUpdate}{' '}{restartState.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void requestRestart()}>
              {messages().misc.restartToUpdate}
            </Button>
            {onLater && (
              <Button size="sm" variant="ghost" onClick={onLater}>
                {messages().misc.later}
              </Button>
            )}
          </div>
        </div>
      )
  }
}
