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
import { useT } from '@/i18n'

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
  const t = useT().plugins
  const close = () => setStep({ kind: 'closed' })
  if (step.kind === 'closed') {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setStep({ kind: 'choosing' })}>
        {t.installFromFolder}
      </Button>
    )
  }
  return (
    <section aria-label={t.installFromComputer} className={panelClassNames}>
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
  const t = useT().plugins
  switch (step.kind) {
    case 'choosing':
      return <ChoosingStep onPick={onPick} onDropPath={onDropPath} onClose={onClose} />
    case 'installing':
      return (
        <p role="status" className="m-0 inline-flex items-center gap-2 text-[13px] text-body">
          <Spinner />
          {t.installingFrom} <code className="font-mono text-[12px] [overflow-wrap:anywhere]">{step.path}</code>…
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
            {t.couldNotInstallLocal(step.message)}
          </p>
          <StepButtons onClose={onClose} closeLabel={t.close} />
        </>
      )
  }
}

function ChoosingStep({ onPick, onDropPath, onClose }: Pick<StepContentProps, 'onPick' | 'onDropPath' | 'onClose'>) {
  const t = useT().plugins
  return (
    <>
      <p className="m-0 text-[13px] leading-normal text-body">
        {t.localIntroBefore} <code className="font-mono text-[12px]">.tar.gz</code> {t.localIntroAfter}
      </p>
      <FileDropZone
        compact
        itemDescription={t.localDropItem}
        accept={localPluginDropAccept}
        onDrop={([droppedItem]) => onDropPath(droppedItem.path)}
        chooseLabel={t.chooseFolder}
        onChoose={() => onPick('folder')}
        secondaryActions={
          <Button variant="secondary" size="sm" onClick={() => onPick('archive')}>
            {t.chooseArchive}
          </Button>
        }
        hint={t.localDropHint}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t.cancel}
        </Button>
      </div>
    </>
  )
}

function ConfirmReplaceStep({ path, onReplace, onClose }: { path: string; onReplace: (path: string) => void; onClose: () => void }) {
  const t = useT().plugins
  return (
    <div role="group" aria-label={t.replaceQuestion} className="flex flex-col gap-2.5">
      <p className="m-0 text-[13px] leading-normal text-body">
        {t.replaceBefore} <code className="font-mono text-[12px] [overflow-wrap:anywhere]">{path}</code>
        {t.replaceAfter}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" onClick={() => onReplace(path)}>
          {t.replace}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t.cancel}
        </Button>
      </div>
    </div>
  )
}

function InstalledStep({ installedPlugin, onClose }: { installedPlugin: InstalledPlugin; onClose: () => void }) {
  const t = useT().plugins
  return (
    <>
      <p role="status" className="m-0 text-[13px] leading-normal text-body">
        {t.installedLocal(installedPlugin.displayName, installedPlugin.version)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link to={pluginDetailPath(installedPlugin.name)} className={buttonClassNames('primary', 'sm', '!text-white')}>
          {t.openPlugin(installedPlugin.displayName)}
        </Link>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t.close}
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
