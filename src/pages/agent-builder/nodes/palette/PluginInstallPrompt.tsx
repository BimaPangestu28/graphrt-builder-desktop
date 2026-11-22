import { useEffect, useRef } from 'react'
import type { PluginCatalogEntry } from '@/api/pluginTypes'
import { Button, buttonClassNames } from '@/components/ui'
import type { PluginInstallProgress } from '@/hooks/usePlugins'
import { describeCommunityInstallNote, describeInstallProgress, describePermissionChips, pluginInstallTrustNote } from '@/pages/plugins/pluginDisplay'
import { PluginIcon } from '@/pages/plugins/PluginIcon'
import type { PendingInstall } from './usePaletteInstall'

interface PluginInstallPromptProps {
  pending: PendingInstall
  /** "after Ask a model", where the step goes once installed. */
  placementText: string
  /** The plugin's catalog entry (what it asks for); null while the catalog loads or is offline. */
  catalogEntry: PluginCatalogEntry | null
  isInstalling: boolean
  progress: PluginInstallProgress | null
  errorMessage: string | null
  onConfirm: () => void
  onCancel: () => void
}

/** "It gets the internet, secrets and 2 settings (A, B)" from the catalog entry. */
export function describeInstallAsks(catalogEntry: PluginCatalogEntry | null): string {
  if (!catalogEntry) return 'Runs its code on this computer. It starts untrusted, without settings or secrets.'
  const chips = describePermissionChips(catalogEntry.permissions, catalogEntry.needsBrowser).map((chip) => chip.toLowerCase())
  const settingNames = catalogEntry.permissions.env
  const asks = chips.map((chip) => (chip.endsWith('setting') || chip.endsWith('settings') ? `${chip} (${settingNames.join(', ')})` : chip))
  const asksText = asks.length > 0 ? ` and asks for: ${asks.join(', ')}` : ''
  return `Runs its code on this computer${asksText}. It starts untrusted, without settings or secrets.`
}

/**
 * The approval step before a catalog plugin installs from the palette (spec 38): names the
 * plugin, what it asks for and where the step will go. Nothing installs until "Install and
 * add" is pressed; Esc or Cancel leaves everything as it was.
 */
export function PluginInstallPrompt({ pending, placementText, catalogEntry, isInstalling, progress, errorMessage, onConfirm, onCancel }: PluginInstallPromptProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const plugin = pending.action.plugin
  useEffect(() => confirmButtonRef.current?.focus(), [pending])
  if (!plugin) return null
  const communityNote = catalogEntry ? describeCommunityInstallNote(catalogEntry) : null
  return (
    <section
      role="alertdialog"
      aria-label={`Install ${plugin.displayName}?`}
      aria-describedby="palette-install-asks"
      className="flex flex-col gap-2.5 rounded-xl border border-amber-line bg-amber-tint p-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !isInstalling) {
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <div className="flex items-center gap-2.5">
        <PluginIcon name={plugin.name} iconUrl={catalogEntry?.iconUrl} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold text-ink">Install {plugin.displayName}?</span>
          <span className="text-[12px] leading-snug text-muted">
            To add {pending.action.displayName} {placementText}
          </span>
        </div>
      </div>
      <p id="palette-install-asks" className="m-0 text-[12px] leading-normal text-body">
        {communityNote && `${communityNote} `}
        {describeInstallAsks(catalogEntry)}
      </p>
      <p className="m-0 text-[12px] font-medium leading-normal text-ink-2">{pluginInstallTrustNote}</p>
      {isInstalling && progress && (
        <span role="status" className="text-[12px] text-ink-2">
          {describeInstallProgress(progress)}
        </span>
      )}
      {errorMessage && (
        <p role="alert" className="m-0 text-[12px] leading-normal text-danger">
          {errorMessage}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {!isInstalling && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <button
          ref={confirmButtonRef}
          type="button"
          className={buttonClassNames('primary', 'sm')}
          disabled={isInstalling}
          onClick={onConfirm}
          aria-label={`Install ${plugin.displayName} and add ${pending.action.displayName}`}
        >
          {isInstalling ? 'Installing…' : 'Install and add'}
        </button>
      </div>
    </section>
  )
}
