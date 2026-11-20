import { useId } from 'react'
import { joinClassNames } from '@/components/ui'

interface PluginTrustToggleProps {
  /** The plugin's display name. */
  pluginLabel: string
  isTrusted: boolean
  isSaving: boolean
  onChange: (trusted: boolean) => void
}

/**
 * "Trust this plugin" checkbox with the warning next to it: trusting hands the plugin its
 * settings and plaintext secrets, and plugins run code on this computer. Tinted amber
 * while untrusted so it stands out, plain once trusted.
 */
export function PluginTrustToggle({ pluginLabel, isTrusted, isSaving, onChange }: PluginTrustToggleProps) {
  const warningId = useId()
  return (
    <div className={joinClassNames('flex flex-col gap-1 rounded-lg border px-3 py-2', isTrusted ? 'border-line bg-subtle' : 'border-amber-line-2 bg-amber-tint')}>
      <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
        <input
          type="checkbox"
          checked={isTrusted}
          disabled={isSaving}
          aria-describedby={warningId}
          onChange={(event) => onChange(event.target.checked)}
          className="size-4 accent-ink"
        />
        Trust {pluginLabel}
        {isSaving && <span className="text-[12px] font-normal text-muted">Saving…</span>}
      </label>
      <p id={warningId} className={joinClassNames('m-0 pl-6 text-[12px] leading-normal', isTrusted ? 'text-muted' : 'text-amber-deep')}>
        Trusting gives {pluginLabel} its settings and secrets in plain text. Plugins run code on this computer: only trust plugins you know.
      </p>
    </div>
  )
}
