import type { NotGoodReason, ReleaseReadiness, TestInput } from '@/api/qualityTypes'
import type { Messages } from '@/i18n/messages'

type QualityMessages = Messages['quality']

/** "price, 9 am" from a word list, for the comma separated field. */
export function wordsToText(words: string[]): string {
  return words.join(', ')
}

/** The words of a comma separated field, trimmed, without empty ones. */
export function textToWords(text: string): string[] {
  return text
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
}

/** A blank test for the "Write a question" form. */
export function emptyTestInput(): TestInput {
  return { question: '', goodAnswer: '', mustInclude: [], mustNotInclude: [], suggested: false }
}

/** Why an answer was not good, in the app language. */
export function describeNotGood(reason: NotGoodReason, t: QualityMessages): string {
  switch (reason.kind) {
    case 'judge':
      return reason.text
    case 'missing_words':
      return t.result.missingWords(reason.words.map((word) => `"${word}"`).join(', '))
    case 'unwanted_words':
      return t.result.unwantedWords(reason.words.map((word) => `"${word}"`).join(', '))
    case 'no_answer':
      return t.result.noAnswer(reason.message)
  }
}

/** Why the latest version cannot be released, in plain words; null when it can. */
export function describeReadiness(readiness: ReleaseReadiness, t: QualityMessages): string | null {
  if (readiness.status === 'ready') return null
  const block = readiness.block
  switch (block.kind) {
    case 'already_released':
      return t.release.alreadyReleased(block.number)
    case 'not_enough_good':
      return t.release.notEnoughGood(block.good, block.total, block.needed)
    case 'check_running':
      return t.release.blocks.checkRunning
    case 'no_tests':
      return t.release.blocks.noTests
    case 'not_checked':
      return t.release.blocks.notChecked
    case 'tests_changed':
      return t.release.blocks.testsChanged
    case 'check_did_not_finish':
      return t.release.blocks.checkDidNotFinish
  }
}

/** Whether going to the Test tab fixes the block (a check or questions are missing). */
export function needsCheck(readiness: ReleaseReadiness): boolean {
  if (readiness.status === 'ready') return false
  return readiness.block.kind !== 'already_released' && readiness.block.kind !== 'check_running'
}
