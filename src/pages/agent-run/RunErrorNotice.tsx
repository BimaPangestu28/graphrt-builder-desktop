/** Red notice for a run that could not be started, loaded or answered. */
export function RunErrorNotice({ title, error }: { title: string; error: Error }) {
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-xl border border-danger-soft bg-surface px-4 py-3">
      <span className="font-semibold text-danger">{title}</span>
      <span className="text-[13px] text-body">{error.message}</span>
    </div>
  )
}
