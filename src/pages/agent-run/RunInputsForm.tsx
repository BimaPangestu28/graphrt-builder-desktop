import { useId, useState, type FormEvent } from 'react'
import type { RunInputs } from '@/api/runReviewTypes'
import type { FlowInput } from '@/api/types'
import { controlForInput, initialRunInputValues, parseRunInputValues, type RunInputValues } from './runInputValues'

interface RunInputsFormProps {
  inputs: FlowInput[]
  /** Inputs of the agent's latest run, used to prefill the form; null when it never ran. */
  lastInputs: RunInputs | null
  isStarting: boolean
  onStart: (inputs: RunInputs) => void
}

const fieldClassNames =
  'box-border w-full rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-ink'

function InputControl({ input, value, onChange }: { input: FlowInput; value: string | boolean; onChange: (value: string | boolean) => void }) {
  const inputId = useId()
  const control = controlForInput(input)
  const labelText = input.required ? input.label : `${input.label} (optional)`

  if (control === 'checkbox') {
    return (
      <label className="flex cursor-pointer items-center gap-2.5">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} className="size-[18px] cursor-pointer accent-ink" />
        {labelText}
      </label>
    )
  }
  const textValue = typeof value === 'string' ? value : ''
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[12px] font-medium text-ink-2">
        {labelText}
      </label>
      {control === 'select' && (
        <select id={inputId} value={textValue} required={input.required} onChange={(event) => onChange(event.target.value)} className={`h-10 ${fieldClassNames}`}>
          {(input.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
      {(control === 'textarea' || control === 'json') && (
        <textarea
          id={inputId}
          rows={control === 'json' ? 4 : 3}
          value={textValue}
          required={input.required}
          spellCheck={control !== 'json'}
          onChange={(event) => onChange(event.target.value)}
          className={`resize-y py-2.5 leading-normal ${control === 'json' ? 'font-mono text-[13px]' : ''} ${fieldClassNames}`}
        />
      )}
      {(control === 'text' || control === 'number') && (
        <input
          id={inputId}
          type={control === 'number' ? 'number' : 'text'}
          value={textValue}
          required={input.required}
          onChange={(event) => onChange(event.target.value)}
          className={`h-10 ${fieldClassNames}`}
        />
      )}
      {control === 'unsupported' && <span className="text-[13px] text-body">This input takes a file, which a test cannot give yet</span>}
    </div>
  )
}

/**
 * The test's inputs, built from the flow's start variables (label, required, a control per
 * graphrt type) and prefilled from the last run. Start stays disabled while a required input
 * is empty or a value cannot be read.
 */
export function RunInputsForm({ inputs, lastInputs, isStarting, onStart }: RunInputsFormProps) {
  const [values, setValues] = useState<RunInputValues>(() => initialRunInputValues(inputs, lastInputs))
  const { inputs: parsedInputs, problems } = parseRunInputValues(inputs, values)

  const submitInputs = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (problems.length === 0 && !isStarting) onStart(parsedInputs)
  }

  return (
    <form aria-label="Test inputs" onSubmit={submitInputs} className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[18px] font-semibold">What should the test use?</h2>
        <span className="text-[13px] text-body">
          {inputs.length === 0 ? 'This agent needs no inputs' : lastInputs ? 'Filled in from the last run' : 'These go to the first step of the agent'}
        </span>
      </div>
      {inputs.map((input) => (
        <InputControl key={input.name} input={input} value={values[input.name] ?? ''} onChange={(value) => setValues((current) => ({ ...current, [input.name]: value }))} />
      ))}
      {problems.length > 0 && <p className="m-0 text-[12px] text-amber-strong">{problems.join(' · ')}</p>}
      <div>
        <button
          type="submit"
          disabled={problems.length > 0 || isStarting}
          className="h-10 cursor-pointer rounded-[9px] border-0 bg-ink px-[18px] text-[14px] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isStarting ? 'Starting…' : 'Start the test'}
        </button>
      </div>
    </form>
  )
}
