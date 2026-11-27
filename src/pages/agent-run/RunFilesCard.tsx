import { useState } from 'react'
import { openRunFile, openRunFileFolder } from '@/api/runSummary'
import type { RunFile } from '@/api/runSummaryTypes'
import { Button } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { messages } from '@/i18n'

interface RunFilesCardProps {
  runId: string
  /** The files the run made that are still on this computer. */
  files: RunFile[]
}

/**
 * Where the run's files are: each file's name and folder with "Open file" (its default app)
 * and "Open folder" (the file manager). Renders nothing for a run that made no file.
 */
export function RunFilesCard({ runId, files }: RunFilesCardProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  if (files.length === 0) return null
  const t = messages().agentRun

  async function open(file: RunFile, openIt: (runId: string, path: string) => Promise<void>) {
    setErrorMessage(null)
    try {
      await openIt(runId, file.path)
    } catch (openError) {
      setErrorMessage(t.couldNotOpenFile(file.name, describeError(openError)))
    }
  }

  return (
    <section aria-label={t.filesFromThisRun(files.length)} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <h3 className="m-0 text-[13px] font-semibold text-ink-2">{t.filesFromThisRun(files.length)}</h3>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {files.map((file) => (
          <li key={file.path} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="flex min-w-0 flex-col gap-0.5">
              <b className="font-semibold [overflow-wrap:anywhere]">{file.name}</b>
              <span className="text-[12px] text-muted [overflow-wrap:anywhere]">{t.savedInFolder(file.folder)}</span>
            </span>
            <span className="flex shrink-0 flex-wrap gap-2">
              {file.canOpen && (
                <Button size="sm" aria-label={t.openFileNamed(file.name)} onClick={() => void open(file, openRunFile)}>
                  {t.openFile}
                </Button>
              )}
              <Button size="sm" variant="secondary" aria-label={t.openFolderOf(file.name)} onClick={() => void open(file, openRunFileFolder)}>
                {t.openFolder}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {errorMessage}
        </p>
      )}
    </section>
  )
}
