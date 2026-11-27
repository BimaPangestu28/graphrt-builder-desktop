import { readFileCards, type FileCard } from '@/api/agentFileTypes'
import type { ConversationMessage } from '@/api/conversationTypes'
import { setLocale } from '@/i18n'
import { fileMetaLine, formatFileSize, readMessageFiles } from '../fileDisplay'

const pdfCard: FileCard = { reference: 'workspace:reports/q3.pdf', name: 'q3.pdf', sizeBytes: 184_320, mimeType: 'application/pdf', kind: 'pdf', preview: 'none' }

function message(metadata: Record<string, unknown>): ConversationMessage {
  return { id: 'm1', conversationId: 'c1', author: 'bot', text: 'q3.pdf', metadata, createdAt: '2026-11-27T08:00:00Z' }
}

describe('formatFileSize', () => {
  it('uses the unit a person reads', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1_229)).toBe('1.2 KB')
    expect(formatFileSize(184_320)).toBe('180 KB')
    expect(formatFileSize(3_565_158)).toBe('3.4 MB')
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25 MB')
  })

  it('writes the decimal the Indonesian way', () => {
    setLocale('id')
    expect(formatFileSize(1_229)).toBe('1,2 KB')
    expect(fileMetaLine(pdfCard)).toBe('PDF · 180 KB')
  })
})

describe('readFileCards', () => {
  it('keeps cards and leaves out anything else', () => {
    const junk = [null, 'q3.pdf', { name: 'x' }, { ...pdfCard, kind: 'program' }, { ...pdfCard, preview: 'html' }, { ...pdfCard, sizeBytes: '12' }]
    expect(readFileCards([pdfCard, ...junk])).toEqual([pdfCard])
    expect(readFileCards(undefined)).toEqual([])
    expect(readFileCards({ 0: pdfCard })).toEqual([])
  })
})

describe('readMessageFiles', () => {
  it('reads attachments and files from the metadata', () => {
    expect(readMessageFiles(message({ attachments: [pdfCard] }))).toEqual({ attachments: [pdfCard], files: [], isFilesOnly: false })
    expect(readMessageFiles(message({ files: [pdfCard], filesOnly: true }))).toEqual({ attachments: [], files: [pdfCard], isFilesOnly: true })
  })

  it('does not hide the text of a message that has no files', () => {
    expect(readMessageFiles(message({ filesOnly: true })).isFilesOnly).toBe(false)
    expect(readMessageFiles(message({})).isFilesOnly).toBe(false)
  })
})
