import { listRunFiles } from '@/api/agentFiles'
import { useLoadedData } from '@/hooks/useRunData'
import { messages } from '@/i18n'
import { FileCardGrid } from './FileCardGrid'

/**
 * The files a run made, as download cards under the run's result. Most runs make none, and
 * then nothing is rendered; a run whose files cannot be listed shows the rest of its result.
 *
 * @param agentId - The run's agent: the files live in its own files (string)
 * @param runId - The run (string)
 *
 * @example
 * <RunFileList agentId={summary.agentId} runId={summary.runId} />
 */
export function RunFileList({ agentId, runId }: { agentId: string; runId: string }) {
  const { data: cards } = useLoadedData(() => listRunFiles(runId), [runId])
  if (!cards || cards.length === 0) return null
  return (
    <section aria-label={messages().files.madeByTheAgent} className="flex flex-col gap-2">
      <h3 className="m-0 text-[13px] font-semibold">{messages().files.madeByTheAgent}</h3>
      <FileCardGrid agentId={agentId} cards={cards} label={messages().files.madeByTheAgent} className="max-w-[40rem]" />
    </section>
  )
}
