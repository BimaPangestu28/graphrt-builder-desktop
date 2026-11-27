import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as agentFilesApi from '@/api/agentFiles'
import { resetSampleAgentFiles } from '@/api/sampleBackend/agentFiles'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleConversations, sampleConversationsBackend } from '@/api/sampleBackend/conversations'
import { clearFilePreviewCache } from '@/components/files/useFilePreview'
import { routePaths } from '@/routes'
import { ChatDetailPage } from '../ChatDetailPage'

async function renderWaitingChat() {
  const rendered = render(
    <MemoryRouter initialEntries={[routePaths.chatDetail]}>
      <ChatDetailPage />
    </MemoryRouter>,
  )
  await screen.findByText('Bot paused · waiting for you')
  return rendered
}

async function attachOneFile() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
  })
}

async function clickSend() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  })
}

describe('ChatDetailPage with files', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleConversations()
    resetSampleAgentFiles()
    clearFilePreviewCache()
  })
  afterEach(() => vi.restoreAllMocks())

  it('attaches a file to the owner’s reply and shows it under the reply', async () => {
    const pickChatAttachments = vi.spyOn(agentFilesApi, 'pickChatAttachments')
    await renderWaitingChat()
    await attachOneFile()
    // The owner's files are asked for as the owner's, whatever the chatbot itself reads.
    expect(pickChatAttachments).toHaveBeenCalledWith(expect.any(String), 'Choose files to send', 0, true)
    expect(within(screen.getByRole('list', { name: 'Attached files' })).getByText('daftar-pesanan-oktober.pdf')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Ini daftar pesanannya kak' } })
    await clickSend()
    expect(await screen.findByText('Ini daftar pesanannya kak')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Attached files' })).not.toBeInTheDocument()
    const sent = await screen.findByRole('region', { name: 'Attached files' })
    expect(within(sent).getByRole('button', { name: 'Download daftar-pesanan-oktober.pdf' })).toBeInTheDocument()
    // Replying took the chat over, as a reply without files does.
    expect(screen.getByText('Bot paused · you are replying')).toBeInTheDocument()
  })

  it('sends a file alone as a reply', async () => {
    await renderWaitingChat()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await attachOneFile()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    await clickSend()
    const sent = await screen.findByRole('region', { name: 'Attached files' })
    expect(within(sent).getByText('daftar-pesanan-oktober.pdf')).toBeInTheDocument()
    expect(screen.getAllByText('daftar-pesanan-oktober.pdf')).toHaveLength(1)
  })

  it('keeps the files on the reply when it could not be sent', async () => {
    vi.spyOn(sampleConversationsBackend, 'sendOperatorReply').mockRejectedValue(new Error('WhatsApp is not connected'))
    await renderWaitingChat()
    await attachOneFile()
    await clickSend()
    expect(await screen.findByRole('alert')).toHaveTextContent('WhatsApp is not connected')
    expect(within(screen.getByRole('list', { name: 'Attached files' })).getByText('daftar-pesanan-oktober.pdf')).toBeInTheDocument()
  })

  it('removes files that were attached but not sent when the chat is left', async () => {
    const discardChatAttachment = vi.spyOn(agentFilesApi, 'discardChatAttachment')
    const { unmount } = await renderWaitingChat()
    await attachOneFile()
    expect(discardChatAttachment).not.toHaveBeenCalled()
    unmount()
    expect(discardChatAttachment).toHaveBeenCalledTimes(1)
    expect(discardChatAttachment).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('daftar-pesanan-oktober.pdf'))
  })

  it('does not remove a file that was sent when the chat is left', async () => {
    const discardChatAttachment = vi.spyOn(agentFilesApi, 'discardChatAttachment')
    const { unmount } = await renderWaitingChat()
    await attachOneFile()
    await clickSend()
    await screen.findByRole('region', { name: 'Attached files' })
    unmount()
    expect(discardChatAttachment).not.toHaveBeenCalled()
  })

  it('cannot attach while the bot is answering', async () => {
    await renderWaitingChat()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hand back to bot' }))
    })
    expect(await screen.findByText('Bot is answering')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeDisabled()
  })
})
