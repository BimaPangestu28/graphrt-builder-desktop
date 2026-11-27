import { act, fireEvent, render, screen, within } from '@testing-library/react'
import * as agentFilesApi from '@/api/agentFiles'
import type { AttachOutcome } from '@/api/agentFileTypes'
import { resetSampleAgentFiles } from '@/api/sampleBackend/agentFiles'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleConversations, sampleConversationsBackend } from '@/api/sampleBackend/conversations'
import { clearFilePreviewCache } from '@/components/files/useFilePreview'
import { setLocale } from '@/i18n'
import { TryItPanel } from '../chatbot-setup/TryItPanel'

const chatbotId = 'catering-assistant'

async function renderTryIt() {
  render(<TryItPanel agentId={chatbotId} />)
  await screen.findByText('Jumat ini jam berapa dikirimnya kak?')
  // The attach button works once the chatbot's abilities are known.
  await act(async () => {})
}

async function attachOneFile() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
  })
}

async function send(text: string) {
  fireEvent.change(screen.getByLabelText('Test message'), { target: { value: text } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  })
}

describe('TryItPanel with files', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleConversations()
    resetSampleAgentFiles()
    clearFilePreviewCache()
  })
  afterEach(() => vi.restoreAllMocks())

  it('attaches a file and a picture, sends them and shows the file the bot hands back', async () => {
    await renderTryIt()
    await attachOneFile()
    await attachOneFile()
    const waiting = screen.getByRole('list', { name: 'Attached files' })
    expect(within(waiting).getByText('daftar-pesanan-oktober.pdf')).toBeInTheDocument()
    expect(within(waiting).getByText('foto-lokasi-acara.jpg')).toBeInTheDocument()

    await send('Tolong ringkas pesanan ini')
    // The composer is empty again and the files moved into the chat as cards.
    expect(screen.queryByRole('list', { name: 'Attached files' })).not.toBeInTheDocument()
    const sent = await screen.findByRole('region', { name: 'Attached files' })
    expect(within(sent).getByRole('button', { name: 'Download daftar-pesanan-oktober.pdf' })).toBeInTheDocument()
    expect(await within(sent).findByRole('img', { name: 'Preview of foto-lokasi-acara.jpg' })).toBeInTheDocument()

    expect(await screen.findByText('Sudah saya baca 2 berkasnya kak, ini ringkasannya.')).toBeInTheDocument()
    const made = screen.getByRole('region', { name: 'Files the agent made' })
    expect(within(made).getByText('ringkasan-pesanan.pdf')).toBeInTheDocument()
    expect(within(made).getByText('PDF · 47 KB')).toBeInTheDocument()

    // The message was stored with the references of exactly the attached files.
    const [testChat] = await sampleConversationsBackend.listConversations({ channel: 'test' })
    const stored = (await sampleConversationsBackend.getConversation(testChat.id)).messages.find((message) => message.text === 'Tolong ringkas pesanan ini')
    expect(stored?.metadata.attachments).toHaveLength(2)
  })

  it('sends files without any text and shows the cards instead of their names', async () => {
    await renderTryIt()
    await attachOneFile()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    const sent = await screen.findByRole('region', { name: 'Attached files' })
    expect(within(sent).getByText('daftar-pesanan-oktober.pdf')).toBeInTheDocument()
    // Only on the card: no bubble repeats the name.
    expect(screen.getAllByText('daftar-pesanan-oktober.pdf')).toHaveLength(1)
    expect(await screen.findByText('Sudah saya baca kak, ini ringkasannya.')).toBeInTheDocument()
  })

  it('takes a file off the message and removes it from the chat', async () => {
    const discardChatAttachment = vi.spyOn(agentFilesApi, 'discardChatAttachment')
    await renderTryIt()
    await attachOneFile()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove daftar-pesanan-oktober.pdf' }))
    })
    expect(screen.queryByRole('list', { name: 'Attached files' })).not.toBeInTheDocument()
    expect(discardChatAttachment).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('daftar-pesanan-oktober.pdf'))
    // Nothing is sent without text or files.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(screen.queryByRole('region', { name: 'Attached files' })).not.toBeInTheDocument()
  })

  it('says in plain words why a file was not attached', async () => {
    const refused: AttachOutcome[] = [
      { name: 'IMG_0042.heic', card: null, problem: 'unsupported_picture' },
      { name: 'video.mp4', card: null, problem: 'unsupported_kind' },
      { name: 'arsip.pdf', card: null, problem: 'too_large' },
    ]
    vi.spyOn(agentFilesApi, 'pickChatAttachments').mockResolvedValue(refused)
    await renderTryIt()
    await attachOneFile()
    const notices = screen.getAllByRole('alert').map((notice) => notice.textContent)
    expect(notices).toEqual([
      'IMG_0042.heic: this kind of picture is not supported yet. Save it as JPG or PNG first',
      'video.mp4: this kind of file is not supported',
      'arsip.pdf: it is larger than 25 MB',
    ])
    expect(screen.queryByRole('list', { name: 'Attached files' })).not.toBeInTheDocument()
  })

  it('explains how to turn files on for a chatbot that does not take them', async () => {
    vi.spyOn(agentFilesApi, 'getAgentFileAbilities').mockResolvedValue({ readsFiles: false, seesPictures: false, makesFiles: false })
    const pickChatAttachments = vi.spyOn(agentFilesApi, 'pickChatAttachments')
    await renderTryIt()
    await attachOneFile()
    expect(screen.getByRole('alert')).toHaveTextContent('This chatbot cannot read files yet. Ask for it in the builder')
    expect(pickChatAttachments).not.toHaveBeenCalled()
  })

  it('puts the files back when the message could not be sent', async () => {
    vi.spyOn(sampleConversationsBackend, 'sendCustomerMessage').mockRejectedValue(new Error('the bot is offline'))
    await renderTryIt()
    await attachOneFile()
    await send('Halo')
    expect(await screen.findByText('the bot is offline')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Attached files' })).getByText('daftar-pesanan-oktober.pdf')).toBeInTheDocument()
  })

  it('speaks Indonesian', async () => {
    setLocale('id')
    render(<TryItPanel agentId={chatbotId} />)
    expect(await screen.findByRole('button', { name: 'Lampirkan berkas' })).toBeInTheDocument()
  })
})
