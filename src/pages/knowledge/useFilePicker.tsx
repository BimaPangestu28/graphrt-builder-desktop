import { useRef, type ReactElement } from 'react'

/**
 * Lets a styled button open the system file picker through a hidden `<input type="file">`.
 * Picked file names are passed to `onFilesPicked`; nothing is uploaded or read.
 *
 * @param onFilesPicked - Called with the picked files' names
 * @param inputLabel - Accessible label of the hidden input
 * @returns `openFilePicker` to call from a button, and `filePickerInput` to render once
 *
 * @example
 * const { openFilePicker, filePickerInput } = useFilePicker(addSources, 'Add files')
 */
export function useFilePicker(onFilesPicked: (fileNames: string[]) => void, inputLabel: string): { openFilePicker: () => void; filePickerInput: ReactElement } {
  const inputRef = useRef<HTMLInputElement>(null)

  const filePickerInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      hidden
      aria-label={inputLabel}
      onChange={(event) => {
        const fileNames = Array.from(event.target.files ?? []).map((file) => file.name)
        if (fileNames.length > 0) onFilesPicked(fileNames)
        event.target.value = ''
      }}
    />
  )

  return { openFilePicker: () => inputRef.current?.click(), filePickerInput }
}
