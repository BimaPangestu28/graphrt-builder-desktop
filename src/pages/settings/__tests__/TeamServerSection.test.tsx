import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CollabStatus, ServerCheck } from '@/api/collabTypes'
import { TeamServerSection, describeCheck, describeServerProblem } from '../TeamServerSection'

const ok: ServerCheck = {
  server: 'https://collab.example.com',
  ok: true,
  problem: null,
  detail: null,
  signInWithBrowser: true,
  signInWithInvite: false,
  signInProviders: [],
  mode: 'self_hosted',
}

const api = vi.hoisted(() => ({
  getCollabStatus: vi.fn(),
  checkCollabServer: vi.fn(),
  setCollabServer: vi.fn(),
  signInToCollab: vi.fn(),
  signOutOfCollab: vi.fn(),
}))
vi.mock('@/api/collab', () => api)

const signedOut: CollabStatus = { server: 'https://collab.graphrt.com', defaultServer: 'https://collab.graphrt.com', signedIn: false, account: null }

describe('Team server check', () => {
  it('says connected, and whether to sign in', () => {
    expect(describeCheck(ok, true)).toEqual({ tone: 'ok', text: 'Connected. This is a Graphrt team server.' })
    expect(describeCheck(ok, false).text).toBe('Connected. Sign in to use it.')
  })

  it('explains each problem in plain words', () => {
    expect(describeServerProblem('tls')).toMatch(/certificate is not valid/)
    expect(describeServerProblem('plain_http')).toMatch(/https:\/\//)
    expect(describeServerProblem('unreachable')).toMatch(/does not answer/)
    expect(describeServerProblem('not_collab')).toMatch(/not a Graphrt team server/)
    expect(describeServerProblem('address')).toMatch(/not a server address/)
    expect(describeCheck({ ...ok, ok: false, problem: 'tls' }, false).tone).toBe('problem')
  })
})

describe('Team server sign in', () => {
  it('shows one button per provider of the server and signs in with the one pressed', async () => {
    const user = userEvent.setup()
    api.getCollabStatus.mockResolvedValue(signedOut)
    api.checkCollabServer.mockResolvedValue({
      ...ok,
      server: signedOut.server,
      mode: 'hosted',
      signInWithInvite: true,
      signInProviders: [
        { id: 'google', name: 'Google' },
        { id: 'microsoft', name: 'Microsoft' },
      ],
    })
    api.signInToCollab.mockResolvedValue(signedOut)
    render(<TeamServerSection />)

    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }))
    expect(api.signInToCollab).toHaveBeenCalledWith('microsoft')
    expect(api.checkCollabServer).toHaveBeenCalledWith('https://collab.graphrt.com')
  })

  it('keeps one Sign in button for a server without named providers', async () => {
    const user = userEvent.setup()
    api.getCollabStatus.mockResolvedValue({ ...signedOut, server: ok.server })
    api.checkCollabServer.mockResolvedValue(ok)
    api.signInToCollab.mockClear()
    api.signInToCollab.mockResolvedValue(signedOut)
    render(<TeamServerSection />)

    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(api.signInToCollab).toHaveBeenCalledWith(undefined)
    expect(screen.queryByRole('button', { name: /Sign in with/ })).not.toBeInTheDocument()
  })
})
