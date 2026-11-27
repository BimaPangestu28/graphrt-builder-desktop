import { StrokeIcon } from '@/components/ui'
import type { AgentStepInfo, ChainInputMapping, ChainStep } from '@/api/chainTypes'
import { failurePolicyOptions, listStepInputNames, runConditionOptions, setStepInputMapping } from './chainEditing'
import { messages } from '@/i18n'

const selectClassNames = 'h-10 rounded-[10px] border border-line-strong bg-surface px-2.5 text-[14px] text-ink'
const fieldLabelClassNames = 'text-[12px] font-medium text-ink-2'
const compactControlClassNames = 'box-border h-9 min-w-0 flex-auto rounded-lg border border-line-strong bg-surface text-[13px] text-ink'

const constantChoice = 'constant'
const emptyChoice = 'none'
const outputChoicePrefix = 'output:'

function readChoice(mapping: ChainInputMapping | undefined): string {
  if (!mapping) return emptyChoice
  return mapping.source.kind === 'output' ? `${outputChoicePrefix}${mapping.source.outputKey}` : constantChoice
}

function buildMapping(inputName: string, choice: string): ChainInputMapping | null {
  if (choice === emptyChoice) return null
  if (choice === constantChoice) return { input: inputName, source: { kind: 'constant', value: '' } }
  return { input: inputName, source: { kind: 'output', outputKey: choice.slice(outputChoicePrefix.length) } }
}

interface InputBindingRowProps {
  inputName: string
  mapping: ChainInputMapping | undefined
  previousAgent: AgentStepInfo | undefined
  onChange: (mapping: ChainInputMapping | null) => void
}

function InputBindingRow({ inputName, mapping, previousAgent, onChange }: InputBindingRowProps) {
  const previousOutputs = previousAgent?.outputs ?? []
  const choice = readChoice(mapping)
  const missingOutput = mapping?.source.kind === 'output' && !previousOutputs.includes(mapping.source.outputKey) ? mapping.source.outputKey : null
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-chip px-3.5 py-3 last:border-b-0">
      <span className="w-[70px] shrink-0 font-mono text-[13px]">{inputName}</span>
      <StrokeIcon size={14} className="shrink-0 text-muted">
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </StrokeIcon>
      <select aria-label={messages().team.valueForInputname(inputName)} value={choice} onChange={(event) => onChange(buildMapping(inputName, event.target.value))} className={`${compactControlClassNames} px-2`}>
        {previousOutputs.map((outputKey) => (
          <option key={outputKey} value={`${outputChoicePrefix}${outputKey}`}>
            {outputKey} {messages().team.from}{' '}{previousAgent?.name}
          </option>
        ))}
        {missingOutput && <option value={`${outputChoicePrefix}${missingOutput}`}>{missingOutput} {messages().team.noLongerGiven}</option>}
        <option value={constantChoice}>{messages().team.typeAValue}</option>
        <option value={emptyChoice}>{messages().team.leaveEmpty}</option>
      </select>
      {mapping?.source.kind === 'constant' && (
        <input
          aria-label={messages().team.textForInputname(inputName)}
          type="text"
          value={String(mapping.source.value ?? '')}
          onChange={(event) => onChange({ input: inputName, source: { kind: 'constant', value: event.target.value } })}
          className={`${compactControlClassNames} basis-full px-2.5`}
        />
      )}
    </div>
  )
}

interface LinkSettingsPanelProps {
  step: ChainStep
  linkNumber: number
  targetAgent: AgentStepInfo | undefined
  previousAgent: AgentStepInfo | undefined
  hasUnsavedChanges: boolean
  isSaving: boolean
  onChange: (updatedStep: ChainStep) => void
  onSave: () => void
}

/** Side panel for the selected link: which outputs feed the next agent, when it runs, and what happens if it fails. */
export function LinkSettingsPanel({ step, linkNumber, targetAgent, previousAgent, hasUnsavedChanges, isSaving, onChange, onSave }: LinkSettingsPanelProps) {
  const targetAgentName = targetAgent?.name ?? messages().lib.theNextAgent
  const previousAgentName = previousAgent?.name ?? messages().lib.thePreviousAgent
  const inputNames = listStepInputNames(step, targetAgent)

  return (
    <aside aria-labelledby="chain-link-heading" className="box-border flex min-w-0 flex-[1_1_340px] flex-col gap-[22px] border-l border-line p-6">
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-muted">
          {messages().team.link}{' '}{linkNumber} {messages().team.to}{' '}{linkNumber + 1}
        </span>
        <h2 id="chain-link-heading" className="m-0 text-[18px] font-semibold">
          {messages().team.passDataTo}{' '}{targetAgentName}
        </h2>
      </div>

      <div className="flex flex-col gap-2">
        <span className={fieldLabelClassNames}>{messages().team.inputsOf}{' '}{targetAgentName}</span>
        <div className="rounded-xl border border-line">
          {inputNames.length === 0 && <p className="m-0 px-3.5 py-3 text-[13px] text-muted">{targetAgentName} {messages().team.needsNoInputs}</p>}
          {inputNames.map((inputName) => (
            <InputBindingRow
              key={inputName}
              inputName={inputName}
              mapping={step.inputs.find((mapping) => mapping.input === inputName)}
              previousAgent={previousAgent}
              onChange={(mapping) => onChange(setStepInputMapping(step, inputName, mapping))}
            />
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClassNames}>{messages().team.run}{' '}{targetAgentName}</span>
        <select value={step.runCondition} onChange={(event) => onChange({ ...step, runCondition: event.target.value as ChainStep['runCondition'] })} className={selectClassNames}>
          {runConditionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label(previousAgentName)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClassNames}>{messages().team.if}{' '}{targetAgentName} {messages().team.fails}</span>
        <select value={step.onFailure} onChange={(event) => onChange({ ...step, onFailure: event.target.value as ChainStep['onFailure'] })} className={selectClassNames}>
          {failurePolicyOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={onSave}
        disabled={!hasUnsavedChanges || isSaving}
        className="h-10 cursor-pointer rounded-[10px] border-0 bg-ink text-[14px] font-medium text-inverse hover:bg-ink-2 disabled:cursor-default disabled:bg-selected disabled:text-muted"
      >
        {isSaving ? messages().team.saving : hasUnsavedChanges ? messages().team.saveLink : messages().team.saved}
      </button>

      <p className="m-0 rounded-[10px] bg-subtle px-3.5 py-3 leading-normal text-body">
        {messages().team.eachAgentKeepsItsOwnApprovals}
      </p>
    </aside>
  )
}
