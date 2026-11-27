import { describe, expect, it } from 'vitest'
import type { ServerCheck } from '@/api/collabTypes'
import { describeCheck, describeServerProblem } from '../TeamServerSection'

const ok: ServerCheck = {
  server: 'https://collab.example.com',
  ok: true,
  problem: null,
  detail: null,
  signInWithBrowser: true,
  signInWithInvite: false,
  mode: 'self_hosted',
}

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
