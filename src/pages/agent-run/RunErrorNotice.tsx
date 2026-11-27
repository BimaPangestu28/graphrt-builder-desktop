import { ErrorHelpNotice } from '@/components/errors/ErrorHelpNotice'
import { explainBackendError } from '@/lib/errorHelp'

/**
 * Red notice for a run that could not be started, loaded or answered. An error of a known
 * kind says what to do next, with the backend's own message kept underneath.
 */
export function RunErrorNotice({ title, error }: { title: string; error: Error }) {
  const help = explainBackendError(error)
  if (help) return <ErrorHelpNotice help={help} title={title} detail={error.message} className="rounded-xl px-4 py-3" />
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-xl border border-danger-soft bg-surface px-4 py-3">
      <span className="font-semibold text-danger">{title}</span>
      <span className="text-[13px] text-body">{error.message}</span>
    </div>
  )
}
