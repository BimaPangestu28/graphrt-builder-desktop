import { checkDroppedItems, describeAccepted, hasAcceptedExtension, lastPathSegment } from '../fileDrop'

const pluginAccept = { extensions: ['tar.gz', 'tgz'], folders: true }

describe('checkDroppedItems', () => {
  it('accepts files with an accepted extension, whatever the case', () => {
    expect(checkDroppedItems([{ path: '/Users/me/Menu.PDF' }], { extensions: ['pdf'] }, true)).toEqual({
      accepted: [{ path: '/Users/me/Menu.PDF', kind: 'file' }],
      rejection: null,
    })
  })

  it('refuses files of other types and names them', () => {
    expect(checkDroppedItems([{ path: '/Users/me/notes.bin' }], { extensions: ['pdf'] }, true)).toEqual({ accepted: [], rejection: 'notes.bin is not a .pdf file' })
  })

  it('keeps the accepted items of a mixed drop and names the rest', () => {
    const check = checkDroppedItems([{ path: '/a/Menu.pdf' }, { path: '/a/x.exe' }, { path: 'C:\\a\\y.bin' }], { extensions: ['pdf'] }, true)
    expect(check.accepted).toEqual([{ path: '/a/Menu.pdf', kind: 'file' }])
    expect(check.rejection).toBe('Left out x.exe, y.bin: drop a .pdf file')
  })

  it('takes a folder or a multi-part extension like .tar.gz for plugins', () => {
    expect(checkDroppedItems([{ path: '/code/my-plugin' }], pluginAccept, false).accepted).toEqual([{ path: '/code/my-plugin', kind: 'folder' }])
    expect(checkDroppedItems([{ path: '/code/my-plugin-0.1.0.tar.gz' }], pluginAccept, false).accepted).toEqual([{ path: '/code/my-plugin-0.1.0.tar.gz', kind: 'file' }])
    expect(checkDroppedItems([{ path: '/code/plugin.zip' }], pluginAccept, false).rejection).toBe('plugin.zip is not a folder or a .tar.gz or .tgz file')
  })

  it('refuses folders where only files go, and trusts the browser when it knows', () => {
    expect(checkDroppedItems([{ path: 'Reports', isFolder: true }], { extensions: [] }, true).rejection).toBe('Reports is not a file')
    expect(checkDroppedItems([{ path: 'Makefile' }], {}, true).accepted).toEqual([{ path: 'Makefile', kind: 'file' }])
  })

  it('refuses several items where one goes, accepting none', () => {
    expect(checkDroppedItems([{ path: '/a/one.pdf' }, { path: '/a/two.pdf' }], { extensions: ['pdf'] }, false)).toEqual({
      accepted: [],
      rejection: 'Drop one item at a time: a .pdf file',
    })
  })

  it('ignores empty drops', () => {
    expect(checkDroppedItems([{ path: ' ' }], {}, true)).toEqual({ accepted: [], rejection: null })
  })
})

describe('fileDrop helpers', () => {
  it('reads the last path segment on every system', () => {
    expect(lastPathSegment('/Users/me/Menu.pdf')).toBe('Menu.pdf')
    expect(lastPathSegment('C:\\Users\\me\\Docs\\')).toBe('Docs')
  })

  it('matches extensions at the end of the name only', () => {
    expect(hasAcceptedExtension('archive.TGZ', ['tgz'])).toBe(true)
    expect(hasAcceptedExtension('tgz-notes.txt', ['tgz'])).toBe(false)
  })

  it('describes what a zone takes', () => {
    expect(describeAccepted({})).toBe('a file')
    expect(describeAccepted({ folders: true, files: false })).toBe('a folder')
    expect(describeAccepted({ extensions: ['pdf', 'docx', 'md', 'txt', 'csv'], folders: true })).toBe('a folder or a .pdf, .docx, .md, .txt and similar file')
  })
})
