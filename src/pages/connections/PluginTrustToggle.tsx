import { useId } from 'react'

interface PluginTrustToggleProps {
  pluginName: string
  isTrusted: boolean
  isSaving: boolean
  onChange: (trusted: boolean) => void
}

/**
 * "Trust this plugin" checkbox with the warning next to it: trusting hands the plugin its
 * settings and plaintext secrets, and plugins run code on this computer.
 */
export function PluginTrustToggle({ pluginName, isTrusted, isSaving, onChange }: PluginTrustToggleProps) {
  const warningId = useId()
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-line-2 bg-amber-tint px-3 py-2.5">
      <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
        <input
          type="checkbox"
          checked={isTrusted}
          disabled={isSaving}
          aria-describedby={warningId}
          onChange={(event) => onChange(event.target.checked)}
          className="size-4 accent-ink"
        />
        Trust {pluginName}
        {isSaving && <span className="text-[12px] font-normal text-muted">Saving…</span>}
      </label>
      <p id={warningId} className="m-0 text-[12px] leading-normal text-amber-deep">
        Trusting gives {pluginName} its settings and secrets in plain text. Plugins run code on this computer: only trust plugins you know.
      </p>
    </div>
  )
}
