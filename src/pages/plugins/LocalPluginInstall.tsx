import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { installLocalPlugin, pickLocalPluginPath, type LocalPluginPickKind } from '@/api/plugins'
import type { InstalledPlugin } from '@/api/pluginTypes'
import { FileDropZone, type FileDropAccept } from '@/components/fileDrop'
import { Button, buttonClassNames, Spinner } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { pluginDetailPath } from '@/routes'
import { useAppSettings } from '@/pages/settings/useAppSettings'

/** Where "Install from folder or archive…" is: closed, choosing, busy, asking to replace, or finished. */
type LocalInstallStep =
  | { kind: 'closed' }
  | { kind: 'choosing' }
  | { kind: 'installing'; path: string }
  | { kind: 'confirmReplace'; path: string }
  | { kind: 'installed'; installedPlugin: InstalledPlugin }
  | { kind: 'failed'; message: string }

/** A plugin folder or a gzipped tarball, like the picker offers. */
const localPluginDropAccept: FileDropAccept = { extensions: ['tar.gz', 'tgz'], folders: true }

const panelClassNames = 'flex max-w-[720px] flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-4'

interface LocalPluginInstallProps {
  /** Reloads the Plugins list after an install. */
  onInstalled: () => Promise<void> | void
}

/**
 * "Install from folder or archive…" on the Plugins page, shown only while Settings › About ›
 * Developer mode is on (the backend refuses sideloading otherwise). Hidden until the
 * preferences load.
 */
export function LocalPluginInstall({ onInstalled }: LocalPluginInstallProps) {
  const { appSettings } = useAppSettings()
  if (!appSettings?.developerMode) return null
  return <LocalPluginInstallPanel onInstalled={onInstalled} />
}

function useLocalInstall(onInstalled: LocalPluginInstallProps['onInstalled']) {
  const [step, setStep] = useState<LocalInstallStep>({ kind: 'closed' })

  async function install(path: string, replace: boolean) {
    setStep({ kind: 'installing', path })
    try {
      const installedPlugin = await installLocalPlugin(path, replace)
      setStep({ kind: 'installed', installedPlugin })
      await onInstalled()
    } catch (installError) {
      if (installError instanceof BackendError && installError.code === 'conflict') {
        setStep({ kind: 'confirmReplace', path })
        return
      }
      setStep({ kind: 'failed', message: describeError(installError) })
    }
  }

  async function pickAndInstall(pickKind: LocalPluginPickKind) {
    try {
      const path = await pickLocalPluginPath(pickKind)
      if (path) await install(path, false)
    } catch (pickError) {
      setStep({ kind: 'failed', message: describeError(pickError) })
    }
  }

  return { step, setStep, install, pickAndInstall }
}

function LocalPluginInstallPanel({ onInstalled }: LocalPluginInstallProps) {
  const { step, setStep, install, pickAndInstall } = useLocalInstall(onInstalled)
  const close = () => setStep({ kind: 'closed' })
  if (step.kind === 'closed') {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setStep({ kind: 'choosing' })}>
        Install from folder or archive…
      </Button>
    )
  }
  return (
    <section aria-label="Install a plugin from this computer" className={panelClassNames}>
      <LocalInstallStepContent
        step={step}
        onPick={(pickKind) => void pickAndInstall(pickKind)}
        onDropPath={(path) => void install(path, false)}
        onReplace={(path) => void install(path, true)}
        onClose={close}
      />
    </section>
  )
}

interface StepContentProps {
  step: Exclude<LocalInstallStep, { kind: 'closed' }>
  onPick: (pickKind: LocalPluginPickKind) => void
  /** A folder or archive dropped on the drop zone. */
  onDropPath: (path: string) => void
  onReplace: (path: string) => void
  onClose: () => void
}

function LocalInstallStepContent({ step, onPick, onDropPath, onReplace, onClose }: StepContentProps) {
  switch (step.kind) {
    case 'choosing':
      return <ChoosingStep onPick={onPick} onDropPath={onDropPath} onClose={onClose} />
    case 'installing':
      return (
        <p role="status" className="m-0 inline-flex items-center gap-2 text-[13px] text-body">
          <Spinner />
          Installing from <code className="font-mono text-[12px] [overflow-wrap:anywhere]">{step.path}</code>…
        </p>
      )
    case 'confirmReplace':
      return <ConfirmReplaceStep path={step.path} onReplace={onReplace} onClose={onClose} />
    case 'installed':
      return <InstalledStep installedPlugin={step.installedPlugin} onClose={onClose} />
    case 'failed':
      return (
        <>
          <p role="alert" className="m-0 text-[13px] leading-normal text-danger">
            Could not install from this computer: {step.message}
          </p>
          <StepButtons onClose={onClose} closeLabel="Close" />
        </>
      )
  }
}

function ChoosingStep({ onPick, onDropPath, onClose }: Pick<StepContentProps, 'onPick' | 'onDropPath' | 'onClose'>) {
  return (
    <>
      <p className="m-0 text-[13px] leading-normal text-body">
        For plugin developers: drop or pick a plugin folder or a <code className="font-mono text-[12px]">.tar.gz</code> archive. graphrt checks its files like a catalog plugin, but nobody has reviewed the code. It is labelled Local · not reviewed,
        starts untrusted and never updates by itself.
      </p>
      <FileDropZone
        compact
        itemDescription="a plugin folder or .tar.gz archive"
        accept={localPluginDropAccept}
        onDrop={([droppedItem]) => onDropPath(droppedItem.path)}
        chooseLabel="Choose folder…"
        onChoose={() => onPick('folder')}
        secondaryActions={
          <Button variant="secondary" size="sm" onClick={() => onPick('archive')}>
            Choose .tar.gz…
          </Button>
        }
        hint="A folder holding graphrt-plugin.json, or a .tar.gz / .tgz archive of one"
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  )
}

function ConfirmReplaceStep({ path, onReplace, onClose }: { path: string; onReplace: (path: string) => void; onClose: () => void }) {
  return (
    <div role="group" aria-label="Replace the catalog plugin?" className="flex flex-col gap-2.5">
      <p className="m-0 text-[13px] leading-normal text-body">
        A plugin with the same name is already installed from the catalog. Replace it with the copy from <code className="font-mono text-[12px] [overflow-wrap:anywhere]">{path}</code>? Its saved settings are removed, and the new copy
        starts untrusted and is never updated from the catalog.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" onClick={() => onReplace(path)}>
          Replace
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function InstalledStep({ installedPlugin, onClose }: { installedPlugin: InstalledPlugin; onClose: () => void }) {
  return (
    <>
      <p role="status" className="m-0 text-[13px] leading-normal text-body">
        Installed {installedPlugin.displayName} v{installedPlugin.version} from this computer. It starts untrusted: open it to trust it and add its settings
      </p>
      <div className="flex flex-wrap gap-2">
        <Link to={pluginDetailPath(installedPlugin.name)} className={buttonClassNames('primary', 'sm', '!text-white')}>
          Open {installedPlugin.displayName}
        </Link>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  )
}

function StepButtons({ onClose, closeLabel }: { onClose: () => void; closeLabel: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" size="sm" onClick={onClose}>
        {closeLabel}
      </Button>
    </div>
  )
}
