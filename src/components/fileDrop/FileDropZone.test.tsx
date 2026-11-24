import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { centerOf, createFakeWindowDragDrop, dropBrowserFiles, placeElement } from '@/test/fileDropTestUtils'
import { FileDropZone, type FileDropZoneProps } from './FileDropZone'

const pdfZoneBox = { left: 0, top: 0, width: 300, height: 150 }
const pluginZoneBox = { left: 0, top: 200, width: 300, height: 150 }

function renderZones(extraProps: Partial<FileDropZoneProps> = {}) {
  const fakeWindow = createFakeWindowDragDrop()
  const onPdfDrop = vi.fn()
  const onPluginDrop = vi.fn()
  const onChoose = vi.fn()
  render(
    <fakeWindow.Provider>
      <FileDropZone
        itemDescription="PDF files"
        accept={{ extensions: ['pdf'] }}
        multiple
        onDrop={onPdfDrop}
        chooseLabel="Choose files…"
        onChoose={onChoose}
        hint="PDF only · up to 50 MB"
        {...extraProps}
      />
      <FileDropZone
        itemDescription="a plugin folder or .tar.gz archive"
        accept={{ extensions: ['tar.gz', 'tgz'], folders: true }}
        onDrop={onPluginDrop}
        chooseLabel="Choose folder…"
        onChoose={() => {}}
      />
    </fakeWindow.Provider>,
  )
  const pdfZone = screen.getByRole('group', { name: 'Drop PDF files' })
  const pluginZone = screen.getByRole('group', { name: 'Drop a plugin folder or .tar.gz archive' })
  placeElement(pdfZone, pdfZoneBox)
  placeElement(pluginZone, pluginZoneBox)
  return { fakeWindow, pdfZone, pluginZone, onPdfDrop, onPluginDrop, onChoose }
}

describe('FileDropZone', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('invites a drag or a choice and describes what it takes', () => {
    const { pdfZone } = renderZones()
    expect(pdfZone).toHaveTextContent('Drag PDF files here or')
    expect(pdfZone).toHaveAccessibleDescription('PDF only · up to 50 MB')
    expect(pdfZone).toHaveAttribute('data-drag-state', 'idle')
  })

  it('highlights only the zone under the pointer and says "Drop to add"', () => {
    const { fakeWindow, pdfZone, pluginZone } = renderZones()
    fakeWindow.dragOver(['/Users/me/Menu.pdf'], centerOf(pdfZoneBox))
    expect(pdfZone).toHaveAttribute('data-drag-state', 'accepting')
    expect(pdfZone).toHaveTextContent('Drop to add')
    expect(pluginZone).toHaveAttribute('data-drag-state', 'idle')

    fakeWindow.emit({ type: 'over', position: centerOf(pluginZoneBox) })
    expect(pdfZone).toHaveAttribute('data-drag-state', 'idle')
    expect(pluginZone).toHaveAttribute('data-drag-state', 'refusing')

    fakeWindow.emit({ type: 'leave' })
    expect(pluginZone).toHaveAttribute('data-drag-state', 'idle')
    expect(screen.queryByText(/is not a folder/)).not.toBeInTheDocument()
  })

  it('routes a drop to the zone under the cursor and ignores drops elsewhere', () => {
    const { fakeWindow, onPdfDrop, onPluginDrop } = renderZones()
    fakeWindow.drop(['/Users/me/code/my-plugin'], centerOf(pluginZoneBox))
    expect(onPluginDrop).toHaveBeenCalledWith([{ path: '/Users/me/code/my-plugin', kind: 'folder' }])
    expect(onPdfDrop).not.toHaveBeenCalled()

    fakeWindow.drop(['/Users/me/Menu.pdf'], { x: 900, y: 900 })
    expect(onPdfDrop).not.toHaveBeenCalled()
  })

  it('filters by type and announces what was left out', () => {
    const { fakeWindow, onPdfDrop } = renderZones()
    fakeWindow.drop(['/a/Menu.pdf', '/a/photo.png'], centerOf(pdfZoneBox))
    expect(onPdfDrop).toHaveBeenCalledWith([{ path: '/a/Menu.pdf', kind: 'file' }])
    const statuses = screen.getAllByRole('status')
    expect(statuses[0]).toHaveTextContent('photo.png is not a .pdf file')
  })

  it('refuses several items on a zone that takes one', () => {
    const { fakeWindow, pluginZone, onPluginDrop } = renderZones()
    fakeWindow.dragOver(['/a/one.tgz', '/a/two.tgz'], centerOf(pluginZoneBox))
    expect(pluginZone).toHaveAttribute('data-drag-state', 'refusing')
    expect(pluginZone).toHaveTextContent('This cannot be added here')
    fakeWindow.emit({ type: 'drop', paths: ['/a/one.tgz', '/a/two.tgz'], position: centerOf(pluginZoneBox) })
    expect(onPluginDrop).not.toHaveBeenCalled()
    expect(pluginZone).toHaveTextContent('Drop one item at a time: a folder or a .tar.gz or .tgz file')
  })

  it('takes several items on a zone that takes many', () => {
    const { fakeWindow, onPdfDrop } = renderZones()
    fakeWindow.drop(['/a/one.pdf', '/a/two.pdf'], centerOf(pdfZoneBox))
    expect(onPdfDrop).toHaveBeenCalledWith([
      { path: '/a/one.pdf', kind: 'file' },
      { path: '/a/two.pdf', kind: 'file' },
    ])
  })

  it('takes HTML drops in the browser preview, with names only', () => {
    const { pdfZone, onPdfDrop } = renderZones()
    dropBrowserFiles(pdfZone, [new File(['%PDF'], 'Menu.pdf', { type: 'application/pdf' }), new File(['x'], 'notes.bin')])
    expect(onPdfDrop).toHaveBeenCalledWith([{ path: 'Menu.pdf', kind: 'file' }])
    expect(pdfZone).toHaveTextContent('notes.bin is not a .pdf file')
  })

  it('opens the picker from the keyboard with the Choose button', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderZones()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Choose files…' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onChoose).toHaveBeenCalledTimes(1)
  })

  it('ignores drags and drops while disabled', () => {
    const { fakeWindow, pdfZone, onPdfDrop } = renderZones({ disabled: true })
    fakeWindow.drop(['/a/Menu.pdf'], centerOf(pdfZoneBox))
    expect(onPdfDrop).not.toHaveBeenCalled()
    expect(pdfZone).toHaveAttribute('data-drag-state', 'idle')
    expect(screen.getByRole('button', { name: 'Choose files…' })).toBeDisabled()
  })
})
