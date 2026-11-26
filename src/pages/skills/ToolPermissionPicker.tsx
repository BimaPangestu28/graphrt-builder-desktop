import { useId } from 'react'
import type { SkillToolRequest, ToolPermission, ToolPermissionMode } from '@/api/skillTypes'
import { useT } from '@/i18n'
import { describeToolRequest } from './skillDisplay'

interface ToolPermissionPickerProps {
  requestedTools: readonly SkillToolRequest[]
  /** Tools of other products the skill mentions; listed as not usable here. */
  unsupportedTools: readonly string[]
  /** What is allowed now. A requested tool that is not here is not allowed. */
  permissions: readonly ToolPermission[]
  onChange: (permissions: ToolPermission[]) => void
  disabled?: boolean
}

/** A newly ticked tool waits for the person's OK on every use. */
const defaultMode: ToolPermissionMode = 'ask'

/**
 * "What it may use": one row per tool the skill asks for, unticked unless `permissions` says
 * otherwise. Ticking a tool allows it with "Ask me first every time"; "Use it without asking"
 * is the person's explicit second choice.
 */
export function ToolPermissionPicker({ requestedTools, unsupportedTools, permissions, onChange, disabled = false }: ToolPermissionPickerProps) {
  const t = useT().skills.tools
  const groupId = useId()

  function setAllowed(tool: string, isAllowed: boolean) {
    const others = permissions.filter((permission) => permission.tool !== tool)
    onChange(isAllowed ? [...others, { tool, mode: defaultMode }] : others)
  }

  function setMode(tool: string, mode: ToolPermissionMode) {
    onChange(permissions.map((permission) => (permission.tool === tool ? { ...permission, mode } : permission)))
  }

  if (requestedTools.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-body">{t.none}</p>
        {unsupportedTools.length > 0 && <p className="m-0 text-[13px] text-muted">{t.unsupported(unsupportedTools.join(', '))}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 max-w-[80ch] leading-normal text-body">{t.intro}</p>
      <ul aria-label={t.listLabel} className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
        {requestedTools.map((request) => {
          const permission = permissions.find((candidate) => candidate.tool === request.tool)
          const label = describeToolRequest(request)
          const radioName = `${groupId}-${request.tool}`
          return (
            <li key={request.tool} className={`flex flex-col gap-2 rounded-[12px] border px-4 py-3 ${permission ? 'border-ink bg-surface' : 'border-line bg-surface'}`}>
              <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-ink">
                <input
                  type="checkbox"
                  aria-label={t.allowTool(label)}
                  checked={permission !== undefined}
                  disabled={disabled}
                  onChange={(event) => setAllowed(request.tool, event.target.checked)}
                  className="size-4 shrink-0 accent-ink"
                />
                <span className="min-w-0 truncate" title={label}>
                  {label}
                </span>
              </label>
              {!request.available && <p className="m-0 pl-[26px] text-[12px] leading-normal text-muted">{t.notAvailable}</p>}
              {permission && (
                <fieldset aria-label={t.modeLabel(label)} className="m-0 flex flex-col gap-1.5 border-0 p-0 pl-[26px]">
                  <ModeOption name={radioName} isSelected={permission.mode === 'ask'} disabled={disabled} label={t.modeAsk} hint={t.modeAskHint} onSelect={() => setMode(request.tool, 'ask')} />
                  <ModeOption name={radioName} isSelected={permission.mode === 'allow'} disabled={disabled} label={t.modeAllow} hint={t.modeAllowHint} onSelect={() => setMode(request.tool, 'allow')} />
                </fieldset>
              )}
            </li>
          )
        })}
      </ul>
      {unsupportedTools.length > 0 && <p className="m-0 text-[13px] text-muted">{t.unsupported(unsupportedTools.join(', '))}</p>}
    </div>
  )
}

interface ModeOptionProps {
  name: string
  isSelected: boolean
  disabled: boolean
  label: string
  hint: string
  onSelect: () => void
}

function ModeOption({ name, isSelected, disabled, label, hint, onSelect }: ModeOptionProps) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[13px] text-ink">
      <input type="radio" name={name} checked={isSelected} disabled={disabled} onChange={onSelect} className="mt-[3px] size-3.5 shrink-0 accent-ink" />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{label}</span>
        <span className="text-[12px] text-muted">{hint}</span>
      </span>
    </label>
  )
}
