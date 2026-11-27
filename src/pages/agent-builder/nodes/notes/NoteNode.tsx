import { createContext, memo, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CanvasNote, CanvasNoteColor } from '@/api/agentGraphTypes'
import { joinClassNames } from '@/components/ui'
import { NodeResizer, type Node, type NodeProps } from '../flow/flowLibrary'
import { messages } from '@/i18n'

/** Smallest size a note can be resized to (canvas units). */
export const noteMinimumSize = { w: 140, h: 72 }

/**
 * Sticky notes as React Flow nodes of type `note`, for the canvas to register next to its step
 * renderers (additive: `nodeTypes={{ ...flowNodeTypes, ...noteNodeTypes }}` and
 * `nodes={[...noteFlowNodes, ...stepNodes]}`). Note node ids carry {@link noteFlowNodeIdPrefix}
 * so they never collide with step ids; edits go through {@link CanvasNotesProvider}.
 */

export const noteFlowNodeIdPrefix = 'note:'

export interface NoteNodeData extends Record<string, unknown> {
  note: CanvasNote
}

export type NoteFlowNode = Node<NoteNodeData, 'note'>

export function isNoteFlowNodeId(flowNodeId: string): boolean {
  return flowNodeId.startsWith(noteFlowNodeIdPrefix)
}

export function noteIdOf(flowNodeId: string): string {
  return flowNodeId.slice(noteFlowNodeIdPrefix.length)
}

/** React Flow nodes for the notes; drawn under the steps (`zIndex: -1`). */
export function toNoteFlowNodes(notes: CanvasNote[]): NoteFlowNode[] {
  return notes.map((note) => ({
    id: `${noteFlowNodeIdPrefix}${note.noteId}`,
    type: 'note',
    position: { x: note.x, y: note.y },
    style: { width: note.w, height: note.h },
    zIndex: -1,
    data: { note },
  }))
}

interface CanvasNotesActions {
  updateNote: (noteId: string, changes: Partial<Omit<CanvasNote, 'noteId'>>) => void
  removeNote: (noteId: string) => void
  readOnly: boolean
}

const CanvasNotesContext = createContext<CanvasNotesActions>({ updateNote: () => undefined, removeNote: () => undefined, readOnly: true })

export function CanvasNotesProvider({ value, children }: { value: CanvasNotesActions; children: ReactNode }) {
  return <CanvasNotesContext.Provider value={value}>{children}</CanvasNotesContext.Provider>
}

const colorClassNames: Record<CanvasNoteColor, string> = {
  yellow: 'bg-note-yellow border-note-yellow-line',
  blue: 'bg-note-blue border-note-blue-line',
  green: 'bg-note-green border-note-green-line',
  pink: 'bg-note-pink border-note-pink-line',
  gray: 'bg-chip border-line-heavy',
}

const noteColors = Object.keys(colorClassNames) as CanvasNoteColor[]

/** One sticky note: drag by its top strip, type in it, resize it, change its color or delete it. */
export const NoteNodeCard = memo(function NoteNodeCard({ data, selected }: NodeProps<NoteFlowNode>) {
  const { note } = data
  const { updateNote, removeNote, readOnly } = useContext(CanvasNotesContext)
  const [draftText, setDraftText] = useState(note.text)
  useEffect(() => setDraftText(note.text), [note.text])
  return (
    <div
      data-testid={`canvas-note-${note.noteId}`}
      className={joinClassNames('box-border flex h-full w-full flex-col rounded-lg border shadow-sm', colorClassNames[note.color] ?? colorClassNames.yellow, selected && 'ring-2 ring-brand')}
    >
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={noteMinimumSize.w}
        minHeight={noteMinimumSize.h}
        lineClassName="container-resize-line"
        handleClassName="container-resize-handle"
        onResizeEnd={(_event, params) => updateNote(note.noteId, { x: Math.round(params.x), y: Math.round(params.y), w: Math.round(params.width), h: Math.round(params.height) })}
      />
      <div className="flex h-6 shrink-0 cursor-grab items-center gap-1 px-2">
        <span className="flex-1 text-[10px] font-semibold tracking-wide text-muted uppercase">{messages().nodes.note}</span>
        {!readOnly && selected && (
          <>
            {noteColors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={messages().nodes.makeTheNoteColor(color)}
                aria-pressed={note.color === color}
                onClick={() => updateNote(note.noteId, { color })}
                className={joinClassNames('nodrag size-3 cursor-pointer rounded-full border p-0', colorClassNames[color], note.color === color && 'ring-1 ring-ink')}
              />
            ))}
            <button type="button" aria-label={messages().nodes.deleteNote} onClick={() => removeNote(note.noteId)} className="nodrag ml-1 cursor-pointer border-0 bg-transparent p-0 text-[12px] text-muted hover:text-danger">
              ✕
            </button>
          </>
        )}
      </div>
      <textarea
        aria-label={messages().nodes.noteText}
        value={draftText}
        readOnly={readOnly}
        placeholder={readOnly ? '' : messages().nodes.writeANote}
        maxLength={4000}
        onChange={(event) => setDraftText(event.target.value)}
        onBlur={() => draftText !== note.text && updateNote(note.noteId, { text: draftText })}
        className="nodrag nowheel box-border min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-2 pb-2 text-[12px] leading-snug text-ink outline-none"
      />
    </div>
  )
})

/** Register next to the step renderers. */
export const noteNodeTypes = { note: NoteNodeCard }
