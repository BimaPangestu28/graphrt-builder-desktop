import { useRef, type ReactElement } from 'react'
import { isDesktopApp } from '@/api/client'
import { pickKnowledgeFiles, pickKnowledgeFolder, SUPPORTED_KNOWLEDGE_EXTENSIONS } from '@/api/knowledge'
import type { KnowledgeSourceKind } from '@/api/knowledgeTypes'

/** Files or one folder chosen by the user. */
export interface PickedSources {
  kind: Extract<KnowledgeSourceKind, 'file' | 'folder'>
  /** Absolute paths in the desktop app; plain names in the browser preview. */
  locations: string[]
}

interface SourcePicker {
  pickFiles: () => void
  pickFolder: () => void
  /** Hidden inputs the browser preview needs; render once. */
  pickerInputs: ReactElement
}

const acceptedFileTypes = SUPPORTED_KNOWLEDGE_EXTENSIONS.map((extension) => `.${extension}`).join(',')

/**
 * Lets buttons pick documents or a folder for a knowledge base. The desktop app
 * uses the system dialog (which returns real paths); the browser preview falls
 * back to hidden `<input type="file">` elements and passes file names only.
 *
 * @param onPicked - Called with what was picked (nothing when the dialog is closed)
 * @param onError - Called when the picker cannot open
 * @param labels - Accessible labels for the file and folder inputs
 *
 * @example
 * const { pickFiles, pickerInputs } = useSourcePicker(addSources, showError, { files: 'Add files', folder: 'Add a folder' })
 */
export function useSourcePicker(
  onPicked: (picked: PickedSources) => void,
  onError: (pickError: unknown) => void,
  labels: { files: string; folder: string },
): SourcePicker {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const pickFiles = () => {
    if (!isDesktopApp()) {
      fileInputRef.current?.click()
      return
    }
    pickKnowledgeFiles(labels.files)
      .then((paths) => {
        if (paths.length > 0) onPicked({ kind: 'file', locations: paths })
      })
      .catch(onError)
  }

  const pickFolder = () => {
    if (!isDesktopApp()) {
      folderInputRef.current?.click()
      return
    }
    pickKnowledgeFolder(labels.folder)
      .then((path) => {
        if (path) onPicked({ kind: 'folder', locations: [path] })
      })
      .catch(onError)
  }

  // `webkitdirectory` is not in React's input types.
  const folderInputAttributes = { webkitdirectory: '' } as Record<string, string>
  const pickerInputs = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept={acceptedFileTypes}
        aria-label={labels.files}
        onChange={(event) => {
          const fileNames = Array.from(event.target.files ?? []).map((file) => file.name)
          if (fileNames.length > 0) onPicked({ kind: 'file', locations: fileNames })
          event.target.value = ''
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        aria-label={labels.folder}
        {...folderInputAttributes}
        onChange={(event) => {
          const firstFile = event.target.files?.[0]
          const folderName = firstFile?.webkitRelativePath.split('/')[0] || firstFile?.name
          if (folderName) onPicked({ kind: 'folder', locations: [folderName] })
          event.target.value = ''
        }}
      />
    </>
  )

  return { pickFiles, pickFolder, pickerInputs }
}
