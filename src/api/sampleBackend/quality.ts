import { BackendError } from '../client'
import type {
  AgentTest,
  CheckProgress,
  CheckView,
  QualityOverview,
  QualitySettings,
  QuestionResult,
  Release,
  ReleaseReadiness,
  ReleaseSwitchOutcome,
  SuggestedTest,
  TestInput,
} from '../qualityTypes'
import { readStoredAgent } from './sampleAgentStore'
import { respondWith, waitFor } from './sampleResponse'

/**
 * Sample tests and releases for the browser preview and tests. It keeps the rules of the
 * desktop backend (`quality::release`): a version is released when its newest check ran
 * the current tests and enough answers were good, else only with a reason; a release never
 * changes; going back puts an earlier release in use. The sample "model" answers every
 * question well except ones about delivery, until the agent has a newer version.
 */

interface SampleCheck {
  view: CheckView
  fingerprint: string
}

interface SampleQuality {
  tests: AgentTest[]
  checks: SampleCheck[]
  releases: Release[]
  inUse: number | null
  settings: QualitySettings
}

const store = new Map<string, SampleQuality>()
const progressListeners = new Set<(progress: CheckProgress) => void>()
let nextId = 1

function qualityOf(agentId: string): SampleQuality {
  let quality = store.get(agentId)
  if (!quality) {
    quality = { tests: [], checks: [], releases: [], inUse: null, settings: { requiredPercent: 80, timesEach: 1 } }
    store.set(agentId, quality)
  }
  return quality
}

function fingerprintOf(tests: AgentTest[]): string {
  return JSON.stringify(tests.map((test) => [test.id, test.question, test.goodAnswer, test.mustInclude, test.mustNotInclude]))
}

function checkedInput(input: TestInput): TestInput {
  const question = input.question.trim()
  if (!question) throw new BackendError('invalid_input', 'write the question to ask')
  const words = (list: string[]) => list.map((word) => word.trim()).filter((word) => word.length > 0)
  return { question, goodAnswer: input.goodAnswer.trim(), mustInclude: words(input.mustInclude), mustNotInclude: words(input.mustNotInclude), suggested: input.suggested }
}

/** How many of `total` answers must be good at `percent` (rounded up), as the backend counts. */
export function neededGood(total: number, percent: number): number {
  return Math.ceil((Math.max(0, total) * Math.min(100, Math.max(0, percent))) / 100)
}

function readinessOf(agentId: string, quality: SampleQuality): ReleaseReadiness {
  const currentVersion = readStoredAgent(agentId).currentVersion
  const released = quality.releases.find((release) => release.agentVersion === currentVersion)
  if (released) return { status: 'blocked', block: { kind: 'already_released', number: released.number }, canOverride: false, checkId: null }
  const latest = quality.checks.find((check) => check.view.agentVersion === currentVersion)
  if (latest?.view.status === 'running') return { status: 'blocked', block: { kind: 'check_running' }, canOverride: false, checkId: latest.view.id }
  if (quality.tests.length === 0) return { status: 'blocked', block: { kind: 'no_tests' }, canOverride: true, checkId: null }
  if (!latest) return { status: 'blocked', block: { kind: 'not_checked' }, canOverride: true, checkId: null }
  const checkId = latest.view.id
  if (latest.fingerprint !== fingerprintOf(quality.tests)) return { status: 'blocked', block: { kind: 'tests_changed' }, canOverride: true, checkId }
  if (latest.view.status !== 'finished') return { status: 'blocked', block: { kind: 'check_did_not_finish' }, canOverride: true, checkId }
  const needed = neededGood(latest.view.total, quality.settings.requiredPercent)
  if (latest.view.total === 0 || latest.view.good < needed) {
    return {
      status: 'blocked',
      block: { kind: 'not_enough_good', good: latest.view.good, total: latest.view.total, needed, requiredPercent: quality.settings.requiredPercent },
      canOverride: true,
      checkId,
    }
  }
  return { status: 'ready', checkId, good: latest.view.good, total: latest.view.total }
}

function sampleAnswer(test: AgentTest, version: number): QuestionResult {
  const aboutDelivery = /deliver|kirim|antar/i.test(test.question)
  const good = !aboutDelivery || version > 1
  return {
    testId: test.id,
    question: test.question,
    good,
    answer: good ? (test.goodAnswer || 'Here is what you asked about.') : 'Sorry, I am not sure about that.',
    goodBecause: good ? 'The reply gives what the good answer says.' : null,
    notGoodBecause: good ? [] : [{ kind: 'judge', text: 'The reply does not say whether the shop delivers.' }],
    change: null,
  }
}

function withCurrentFingerprint(check: SampleCheck, quality: SampleQuality): CheckView {
  return { ...check.view, testsChangedSince: check.fingerprint !== fingerprintOf(quality.tests) }
}

function emit(progress: CheckProgress) {
  for (const listener of progressListeners) listener(progress)
}

async function runSampleCheck(agentId: string, quality: SampleQuality, check: SampleCheck, tests: AgentTest[]) {
  const previous = quality.checks.find((candidate) => candidate !== check && candidate.view.status === 'finished')
  const questions: QuestionResult[] = []
  for (const test of tests) {
    await waitFor(400)
    const result = sampleAnswer(test, check.view.agentVersion)
    const before = previous?.view.questions.find((question) => question.testId === test.id)
    result.change = !previous ? null : !before ? 'new' : before.good === result.good ? null : result.good ? 'now_good' : 'now_not_good'
    questions.push(result)
    emit({ agentId, checkId: check.view.id, done: questions.length, total: tests.length, finished: false })
  }
  const good = questions.filter((question) => question.good).length
  const needed = neededGood(tests.length, check.view.requiredPercent)
  check.view = {
    ...check.view,
    status: 'finished',
    finishedAt: new Date().toISOString(),
    good,
    needed,
    enoughGood: tests.length > 0 && good >= needed,
    questions,
    previous: previous ? { checkId: previous.view.id, agentVersion: previous.view.agentVersion, good: previous.view.good, total: previous.view.total } : null,
  }
  emit({ agentId, checkId: check.view.id, done: tests.length, total: tests.length, finished: true })
}

export const sampleQualityBackend = {
  getAgentQuality(agentId: string): Promise<QualityOverview> {
    return respondWith(() => {
      const agent = readStoredAgent(agentId)
      const quality = qualityOf(agentId)
      return {
        agentId,
        currentVersion: agent.currentVersion,
        tests: [...quality.tests],
        latestCheck: quality.checks[0] ? withCurrentFingerprint(quality.checks[0], quality) : null,
        readiness: readinessOf(agentId, quality),
        releases: [...quality.releases],
        inUse: quality.releases.find((release) => release.number === quality.inUse) ?? null,
        settings: { ...quality.settings },
        canCheck: true,
      }
    })
  },

  addAgentTests(agentId: string, inputs: TestInput[]): Promise<AgentTest[]> {
    return respondWith(() => {
      const quality = qualityOf(agentId)
      const now = new Date().toISOString()
      const added = inputs.map(checkedInput).map((input) => ({ ...input, id: `sample-test-${nextId++}`, agentId, createdAt: now, updatedAt: now }))
      quality.tests.push(...added)
      return [...quality.tests]
    })
  },

  updateAgentTest(agentId: string, testId: string, input: TestInput): Promise<AgentTest> {
    return respondWith(() => {
      const quality = qualityOf(agentId)
      const index = quality.tests.findIndex((test) => test.id === testId)
      if (index < 0) throw new BackendError('not_found', `test ${testId} not found`)
      const updated = { ...quality.tests[index], ...checkedInput(input), suggested: false, updatedAt: new Date().toISOString() }
      quality.tests[index] = updated
      return updated
    })
  },

  deleteAgentTest(agentId: string, testId: string): Promise<void> {
    return respondWith(() => {
      const quality = qualityOf(agentId)
      quality.tests = quality.tests.filter((test) => test.id !== testId)
    })
  },

  async suggestAgentTests(agentId: string): Promise<SuggestedTest[]> {
    await waitFor(900)
    return respondWith(() => {
      const agent = readStoredAgent(agentId)
      return [
        { question: 'What are your opening hours?', goodAnswer: 'We are open Monday to Saturday, 9 in the morning to 5 in the afternoon.' },
        { question: 'How much is the lunch box?', goodAnswer: 'The lunch box is Rp 35.000.' },
        { question: 'Do you deliver to the office?', goodAnswer: 'Yes, we deliver in Jakarta for orders of 10 boxes or more.' },
        { question: `Can ${agent.name} take my payment?`, goodAnswer: 'No. It says a person from the shop will send the payment details.' },
      ]
    })
  },

  startAgentCheck(agentId: string): Promise<CheckView> {
    return respondWith(() => {
      const quality = qualityOf(agentId)
      if (quality.tests.length === 0) throw new BackendError('invalid_input', 'add a test question first')
      if (quality.checks[0]?.view.status === 'running') throw new BackendError('conflict', 'A check of this agent is already running')
      const tests = [...quality.tests]
      const check: SampleCheck = {
        fingerprint: fingerprintOf(tests),
        view: {
          id: `sample-check-${nextId++}`,
          agentVersion: readStoredAgent(agentId).currentVersion,
          status: 'running',
          startedAt: new Date().toISOString(),
          finishedAt: null,
          good: 0,
          total: tests.length,
          requiredPercent: quality.settings.requiredPercent,
          needed: neededGood(tests.length, quality.settings.requiredPercent),
          enoughGood: false,
          testsChangedSince: false,
          errorMessage: null,
          questions: [],
          previous: null,
        },
      }
      quality.checks.unshift(check)
      void runSampleCheck(agentId, quality, check, tests)
      return { ...check.view }
    })
  },

  getAgentCheck(agentId: string, checkId: string): Promise<CheckView> {
    return respondWith(() => {
      const quality = qualityOf(agentId)
      const check = quality.checks.find((candidate) => candidate.view.id === checkId)
      if (!check) throw new BackendError('not_found', `check ${checkId} not found`)
      return withCurrentFingerprint(check, quality)
    })
  },

  setAgentQualitySettings(agentId: string, settings: QualitySettings): Promise<QualitySettings> {
    return respondWith(() => {
      if (settings.requiredPercent < 0 || settings.requiredPercent > 100) throw new BackendError('invalid_input', 'the share of good answers is between 0 and 100 percent')
      if (settings.timesEach < 1 || settings.timesEach > 5) throw new BackendError('invalid_input', 'ask each question 1 to 5 times')
      qualityOf(agentId).settings = { ...settings }
      return { ...settings }
    })
  },

  createAgentRelease(agentId: string, notes: string, overrideReason: string | null): Promise<Release> {
    return respondWith(() => {
      const quality = qualityOf(agentId)
      const readiness = readinessOf(agentId, quality)
      const reason = overrideReason?.trim() ? overrideReason.trim() : null
      if (readiness.status === 'blocked' && (!readiness.canOverride || !reason)) throw new BackendError('invalid_input', 'this version may not be released yet')
      const checkId = readiness.checkId
      const check = quality.checks.find((candidate) => candidate.view.id === checkId)?.view
      const release: Release = {
        agentId,
        number: (quality.releases[0]?.number ?? 0) + 1,
        agentVersion: readStoredAgent(agentId).currentVersion,
        notes: notes.trim(),
        checkId,
        passed: check?.good ?? null,
        total: check?.total ?? null,
        requiredPercent: quality.settings.requiredPercent,
        overrideReason: readiness.status === 'ready' ? null : reason,
        createdAt: new Date().toISOString(),
      }
      quality.releases.unshift(release)
      quality.inUse = release.number
      return release
    })
  },

  switchAgentRelease(agentId: string, releaseNumber: number): Promise<ReleaseSwitchOutcome> {
    return respondWith(() => {
      const quality = qualityOf(agentId)
      const release = quality.releases.find((candidate) => candidate.number === releaseNumber)
      if (!release || quality.inUse === releaseNumber) throw new BackendError('invalid_input', `release ${releaseNumber} is already in use or does not exist`)
      quality.inUse = releaseNumber
      return { release, online: { kind: 'not_online' } }
    })
  },
}

/** Sample progress events of {@link sampleQualityBackend.startAgentCheck}. */
export function subscribeToSampleCheckProgress(onProgress: (progress: CheckProgress) => void): Promise<() => void> {
  progressListeners.add(onProgress)
  return Promise.resolve(() => {
    progressListeners.delete(onProgress)
  })
}

/** Test helper: forgets every sample test, check and release. */
export function resetSampleQuality(): void {
  store.clear()
}
