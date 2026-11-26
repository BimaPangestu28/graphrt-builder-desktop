import { useRef, useState } from 'react'
import { isDesktopApp } from '@/api/client'
import { pickFilePaths } from '@/api/fileDrop'
import { FileDropZone, type FileDropAccept } from '@/components/fileDrop'
import { Icon } from '@/components/ui'
import { lastPathSegment } from '@/lib/fileDrop'
import { toError } from '@/lib/errors'
import { messages } from '@/i18n'

/** Run file inputs take any single file (folders are refused); the runtime checks the content. */
const runFileDropAccept: FileDropAccept = { files: true, folders: false }

/** graphrt's document reader refuses files over 50 MB, and the desktop backend checks it on start. */
export function runFileSizeHint(): string {
  return messages().agentRun.fileSizeHint
}

interface RunFileInputProps {
  /** The input's visible label ("Invoice", "Photos (optional)"). */
  label: string
  /** A file list takes several files; a file input takes one. */
  multiple: boolean
  /** The chosen paths (absolute in the desktop app, names in the browser preview). */
  paths: string[]
  onChange: (paths: string[]) => void
}

/**
 * A `file` / `file-list` start input on the Test form: a drop zone with a Choose button (the
 * system picker in the desktop app, a file input in the browser preview) and the chosen files,
 * each removable. A file input keeps the latest file; a file list adds to what is chosen.
 */
export function RunFileInput({ label, multiple, paths, onChange }: RunFileInputProps) {
  const browserInputRef = useRef<HTMLInputElement>(null)
  const [pickError, setPickError] = useState<string | null>(null)

  const addPaths = (newPaths: string[]) => {
    if (newPaths.length === 0) return
    setPickError(null)
    onChange(multiple ? [...paths, ...newPaths.filter((path) => !paths.includes(path))] : [newPaths[0]])
  }

  const choose = () => {
    if (!isDesktopApp()) {
      browserInputRef.current?.click()
      return
    }
    pickFilePaths(multiple ? messages().agentRun.chooseFilesFor(label) : messages().agentRun.chooseFileFor(label), multiple)
      .then(addPaths)
      .catch((error: unknown) => setPickError(messages().agentRun.couldNotOpenPicker(toError(error).message)))
  }

  return (
    <div className="flex flex-col gap-2">
      <FileDropZone
        compact
        itemDescription={multiple ? messages().agentRun.filesFor(label) : messages().agentRun.aFileFor(label)}
        accept={runFileDropAccept}
        multiple={multiple}
        onDrop={(droppedItems) => addPaths(droppedItems.map((item) => item.path))}
        chooseLabel={multiple ? messages().agentRun.chooseFiles : paths.length > 0 ? messages().agentRun.chooseAnotherFile : messages().agentRun.chooseAFile}
        onChoose={choose}
        hint={runFileSizeHint()}
      />
      <input
        ref={browserInputRef}
        type="file"
        hidden
        multiple={multiple}
        aria-label={multiple ? messages().agentRun.chooseFilesFor(label) : messages().agentRun.chooseFileFor(label)}
        onChange={(event) => {
          addPaths(Array.from(event.target.files ?? []).map((file) => file.name))
          event.target.value = ''
        }}
      />
      {pickError && (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {pickError}
        </p>
      )}
      {paths.length > 0 && <ChosenFileList label={label} paths={paths} onRemove={(removedPath) => onChange(paths.filter((path) => path !== removedPath))} />}
    </div>
  )
}

function ChosenFileList({ label, paths, onRemove }: { label: string; paths: string[]; onRemove: (path: string) => void }) {
  return (
    <ul aria-label={messages().agentRun.chosenFor(label)} className="m-0 flex list-none flex-col gap-1.5 p-0">
      {paths.map((path) => (
        <li key={path} className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px]">
          <span aria-hidden="true" className="text-muted">
            <Icon name="file" size={14} />
          </span>
          <span className="min-w-0 flex-1 truncate" title={path}>
            {lastPathSegment(path)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(path)}
            aria-label={messages().agentRun.removeFile(lastPathSegment(path))}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-chip hover:text-ink"
          >
            <Icon name="close" size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}
