import { StrokeIcon } from '@/components/ui'
import { failurePolicyOptions, runConditionOptions, type ChainInputBinding, type ChainLink } from '@/data/chain'

const selectClassNames = 'h-10 rounded-[10px] border border-line-strong bg-surface px-2.5 text-[14px] text-ink'
const fieldLabelClassNames = 'text-[12px] font-medium text-ink-2'
const compactControlClassNames = 'box-border h-9 min-w-0 flex-auto rounded-lg border border-line-strong bg-surface text-[13px] text-ink'

interface InputBindingRowProps {
  input: ChainInputBinding
  onChange: (updatedInput: ChainInputBinding) => void
}

function InputBindingRow({ input, onChange }: InputBindingRowProps) {
  return (
    <div className="flex items-center gap-2.5 border-b border-chip px-3.5 py-3 last:border-b-0">
      <span className="w-[70px] shrink-0 font-mono text-[13px]">{input.name}</span>
      <StrokeIcon size={14} className="shrink-0 text-muted">
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </StrokeIcon>
      {input.kind === 'output' ? (
        <select
          aria-label={`Value for ${input.name}`}
          value={input.selectedField}
          onChange={(event) => onChange({ ...input, selectedField: event.target.value })}
          className={`${compactControlClassNames} px-2`}
        >
          {input.sources.map((source) => (
            <option key={source.field} value={source.field}>
              {source.field} from {source.agentName}
            </option>
          ))}
        </select>
      ) : (
        <input
          aria-label={`Value for ${input.name}`}
          type="text"
          value={input.value}
          onChange={(event) => onChange({ ...input, value: event.target.value })}
          className={`${compactControlClassNames} px-2.5`}
        />
      )}
    </div>
  )
}

interface LinkSettingsPanelProps {
  link: ChainLink
  linkNumber: number
  targetAgentName: string
  onChange: (updatedLink: ChainLink) => void
}

/** Side panel for the selected link: which outputs feed the next agent, when it runs, and what happens if it fails. */
export function LinkSettingsPanel({ link, linkNumber, targetAgentName, onChange }: LinkSettingsPanelProps) {
  const updateInput = (inputIndex: number, updatedInput: ChainInputBinding) =>
    onChange({ ...link, inputs: link.inputs.map((input, index) => (index === inputIndex ? updatedInput : input)) })

  return (
    <aside aria-labelledby="chain-link-heading" className="box-border flex min-w-0 flex-[1_1_340px] flex-col gap-[22px] border-l border-line p-6">
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-muted">
          Link {linkNumber} to {linkNumber + 1}
        </span>
        <h2 id="chain-link-heading" className="m-0 text-[18px] font-semibold">
          Pass data to {targetAgentName}
        </h2>
      </div>

      <div className="flex flex-col gap-2">
        <span className={fieldLabelClassNames}>Inputs of {targetAgentName}</span>
        <div className="rounded-xl border border-line">
          {link.inputs.map((input, inputIndex) => (
            <InputBindingRow key={input.name} input={input} onChange={(updatedInput) => updateInput(inputIndex, updatedInput)} />
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClassNames}>Run {targetAgentName}</span>
        <select value={link.runCondition} onChange={(event) => onChange({ ...link, runCondition: event.target.value })} className={selectClassNames}>
          {runConditionOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClassNames}>If {targetAgentName} fails</span>
        <select value={link.failurePolicy} onChange={(event) => onChange({ ...link, failurePolicy: event.target.value })} className={selectClassNames}>
          {failurePolicyOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>

      <p className="m-0 rounded-[10px] bg-subtle px-3.5 py-3 leading-normal text-body">
        Each agent keeps its own approvals. The chain waits while one of them is waiting for you
      </p>
    </aside>
  )
}
