import { useCallback, useEffect, useRef, useState } from 'react'
import { getCanvasNotes, saveCanvasNotes } from '@/api/agentGraph'
import type { CanvasNote, CanvasNoteColor } from '@/api/agentGraphTypes'

/** Note edits are saved this long after the last change (typing, moving). */
export const noteSaveDelayMs = 700

export const defaultNoteSize = { w: 220, h: 120 }

export interface CanvasNotesController {
  notes: CanvasNote[]
  /** Adds an empty note at `position` (canvas units) and returns its id. */
  addNote: (position: { x: number; y: number }, color?: CanvasNoteColor) => string
  updateNote: (noteId: string, changes: Partial<Omit<CanvasNote, 'noteId'>>) => void
  removeNote: (noteId: string) => void
  /** The last save that failed, kept until the next one works. */
  saveError: Error | null
}

function newNoteId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `note-${random}`
}

/**
 * Sticky notes of the canvas for one version (`get_canvas_notes` / `save_canvas_notes`).
 * Changes show at once and are saved a moment later; adding a note adds no version, and every
 * new version copies the notes forward (the backend does), so they follow the agent.
 *
 * @param agentId - Agent (string)
 * @param version - The version on the canvas, or null while it loads (number | null)
 * @returns Notes and their actions (CanvasNotesController)
 */
export function useCanvasNotes(agentId: string, version: number | null): CanvasNotesController {
  const [notes, setNotes] = useState<CanvasNote[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [saveError, setSaveError] = useState<Error | null>(null)
  const loadedVersionRef = useRef<number | null>(null)

  useEffect(() => {
    if (version === null) return
    let isCurrent = true
    loadedVersionRef.current = null
    getCanvasNotes(agentId, version)
      .then((noteSet) => {
        if (!isCurrent) return
        loadedVersionRef.current = version
        setNotes(noteSet.notes)
        setIsDirty(false)
      })
      .catch((loadError: unknown) => console.warn('could not read the canvas notes', loadError))
    return () => {
      isCurrent = false
    }
  }, [agentId, version])

  useEffect(() => {
    if (!isDirty || version === null || loadedVersionRef.current !== version) return
    const timer = window.setTimeout(() => {
      saveCanvasNotes(agentId, version, notes)
        .then(() => {
          setIsDirty(false)
          setSaveError(null)
        })
        .catch((rawError: unknown) => setSaveError(rawError instanceof Error ? rawError : new Error(String(rawError))))
    }, noteSaveDelayMs)
    return () => window.clearTimeout(timer)
  }, [agentId, version, notes, isDirty])

  const changeNotes = useCallback((change: (current: CanvasNote[]) => CanvasNote[]) => {
    setNotes(change)
    setIsDirty(true)
  }, [])

  const addNote = useCallback(
    (position: { x: number; y: number }, color: CanvasNoteColor = 'yellow') => {
      const noteId = newNoteId()
      changeNotes((current) => [...current, { noteId, x: Math.round(position.x), y: Math.round(position.y), ...defaultNoteSize, text: '', color }])
      return noteId
    },
    [changeNotes],
  )

  const updateNote = useCallback(
    (noteId: string, changes: Partial<Omit<CanvasNote, 'noteId'>>) => changeNotes((current) => current.map((note) => (note.noteId === noteId ? { ...note, ...changes } : note))),
    [changeNotes],
  )

  const removeNote = useCallback((noteId: string) => changeNotes((current) => current.filter((note) => note.noteId !== noteId)), [changeNotes])

  return { notes, addNote, updateNote, removeNote, saveError }
}
