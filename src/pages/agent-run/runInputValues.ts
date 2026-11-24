import type { RunInputs } from '@/api/runReviewTypes'
import type { FlowInput } from '@/api/types'

/**
 * Form state of a flow's start inputs (screen 06): the control each graphrt input type gets,
 * the values a form starts with (the last run's inputs, else the workflow default) and the
 * typed inputs a run starts with. Text and number values are kept as strings, checkboxes as
 * booleans, a file as its path and a file list as a list of paths (absolute in the desktop app,
 * which turns them into graphrt files; plain names in the browser preview).
 */

export type RunInputControl = 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'json' | 'file' | 'file-list'

/** One input's form value: text, a checkbox, or the chosen file paths of a file list. */
export type RunInputValue = string | boolean | string[]

export type RunInputValues = Record<string, RunInputValue>

const controlByInputType: Record<string, RunInputControl> = {
  'text-input': 'text',
  text: 'text',
  string: 'text',
  paragraph: 'textarea',
  select: 'select',
  number: 'number',
  integer: 'number',
  checkbox: 'checkbox',
  boolean: 'checkbox',
  json: 'json',
  object: 'json',
  array: 'json',
  file: 'file',
  'file-list': 'file-list',
  'array[file]': 'file-list',
}

/** The control an input is filled with, from its graphrt `type` (unknown types are text). */
export function controlForInput(input: FlowInput): RunInputControl {
  return controlByInputType[(input.inputType ?? 'text-input').toLowerCase()] ?? 'text'
}

function toFileListValue(rawValue: unknown): string[] {
  if (typeof rawValue === 'string') return rawValue === '' ? [] : [rawValue]
  return Array.isArray(rawValue) ? rawValue.filter((item): item is string => typeof item === 'string') : []
}

function toFormValue(input: FlowInput, rawValue: unknown): RunInputValue {
  const control = controlForInput(input)
  if (control === 'checkbox') return rawValue === true
  if (control === 'file-list') return toFileListValue(rawValue)
  if (control === 'file') return typeof rawValue === 'string' ? rawValue : ''
  if (rawValue === null || rawValue === undefined) return control === 'select' ? (input.options?.[0] ?? '') : ''
  if (typeof rawValue === 'string') return rawValue
  return control === 'json' ? JSON.stringify(rawValue, null, 2) : String(rawValue)
}

/**
 * The values the form starts with: the last run's value of each input, else the workflow's default.
 *
 * @param inputs - The flow's start inputs (FlowInput[])
 * @param lastInputs - Inputs of the agent's latest run, or null (RunInputs | null)
 */
export function initialRunInputValues(inputs: FlowInput[], lastInputs: RunInputs | null): RunInputValues {
  return Object.fromEntries(
    inputs.map((input) => {
      const lastValue = lastInputs && input.name in lastInputs ? lastInputs[input.name] : undefined
      return [input.name, toFormValue(input, lastValue ?? input.defaultValue)]
    }),
  )
}

/** The typed inputs and the problems that block starting (one message per input). */
export interface ParsedRunInputs {
  inputs: RunInputs
  problems: string[]
}

function parseFileValue(input: FlowInput, formValue: RunInputValue | undefined): { value?: unknown; problem?: string } {
  const paths = (Array.isArray(formValue) ? formValue : typeof formValue === 'string' ? [formValue] : []).map((path) => path.trim()).filter(Boolean)
  if (paths.length === 0) return input.required ? { problem: `Choose ${controlForInput(input) === 'file' ? 'a file' : 'files'} for ${input.label}` } : {}
  return { value: controlForInput(input) === 'file' ? paths[0] : paths }
}

function parseInputValue(input: FlowInput, formValue: RunInputValue | undefined): { value?: unknown; problem?: string } {
  const control = controlForInput(input)
  if (control === 'checkbox') return { value: formValue === true }
  if (control === 'file' || control === 'file-list') return parseFileValue(input, formValue)
  const text = typeof formValue === 'string' ? formValue.trim() : ''
  if (text === '') return input.required ? { problem: `Fill in ${input.label}` } : {}
  if (control === 'number') {
    const numberValue = Number(text)
    return Number.isFinite(numberValue) ? { value: numberValue } : { problem: `${input.label} must be a number` }
  }
  if (control === 'json') {
    try {
      return { value: JSON.parse(text) as unknown }
    } catch {
      return { problem: `${input.label} is not valid JSON` }
    }
  }
  return { value: typeof formValue === 'string' ? formValue : text }
}

/**
 * Converts the form into run inputs; empty optional inputs are left out so graphrt applies
 * the workflow default.
 */
export function parseRunInputValues(inputs: FlowInput[], values: RunInputValues): ParsedRunInputs {
  const parsedInputs: RunInputs = {}
  const problems: string[] = []
  for (const input of inputs) {
    const { value, problem } = parseInputValue(input, values[input.name])
    if (problem) problems.push(problem)
    else if (value !== undefined) parsedInputs[input.name] = value
  }
  return { inputs: parsedInputs, problems }
}

const maxSummaryValueLength = 40

/** "cafe · Bandar Lampung · catering menu" from a run's short text and number inputs; null when none. */
export function summarizeRunInputs(inputs: RunInputs | null): string | null {
  if (!inputs) return null
  const parts = Object.values(inputs)
    .filter((value): value is string | number => (typeof value === 'string' && value.trim() !== '') || typeof value === 'number')
    .map((value) => String(value))
    .filter((text) => text.length <= maxSummaryValueLength)
  return parts.length > 0 ? parts.join(' · ') : null
}
