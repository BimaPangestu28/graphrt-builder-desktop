/**
 * What an agent answered in a run, read from the run's outputs: the text a person would call
 * "the answer", as opposed to the one-line `summary`, the `items` list and the counters.
 */

/** Output names that hold the answer when a run has several texts, in order of preference. */
const answerOutputNames = ['answer', 'reply', 'message', 'result', 'response', 'text', 'output'] as const

/** Outputs that are text but are shown elsewhere on the screen. */
const otherTextOutputs = new Set(['summary'])

/**
 * The answer of a run, or null when it gave no text (a run that only lists items or counts,
 * or one that failed before answering).
 *
 * @param outputs - The run's outputs (`Run.outputs`), null while it runs
 * @returns The text of the output named like an answer; else every other text output, one
 *   paragraph each
 *
 * @example
 * readRunAnswer({ result: 'We open at 9.', summary: 'Answered 1 question' }) // 'We open at 9.'
 * readRunAnswer({ summary: 'Sent 3 offers', messages_sent: 3 }) // null
 */
export function readRunAnswer(outputs: Record<string, unknown> | null | undefined): string | null {
  if (!outputs) return null
  const texts = Object.entries(outputs).flatMap(([name, value]) =>
    typeof value === 'string' && value.trim().length > 0 && !otherTextOutputs.has(name) ? [{ name, text: value.trim() }] : [],
  )
  if (texts.length === 0) return null
  const named = answerOutputNames.map((name) => texts.find((text) => text.name === name)).find((text) => text !== undefined)
  return named ? named.text : texts.map((text) => text.text).join('\n\n')
}
