import { useState, type FormEvent } from 'react'
import { getFileManagerName, getTrayAreaName } from '@/lib/platform'
import { Link } from 'react-router-dom'
import { revealDataFolder } from '@/api/appInfo'
import type { AppSettings } from '@/api/appSettingsTypes'
import type { AppInfo } from '@/api/connectionTypes'
import type { MissedRunPolicy } from '@/api/types'
import {
  appearanceOptions,
  describeRetention,
  languageOptions,
  missedRunPolicyLabels,
  modelFallbackOptions,
  runHistoryRetentionChoices,
} from '@/lib/settings'
import { describeError } from '@/lib/agentDisplay'
import { connectionsTabPath } from '@/routes'
import { useOnboardingTour } from '../onboarding/onboardingTourContext'
import { CrashReportsPanel } from './CrashReportsPanel'
import { DataActions } from './DataActions'
import { DefaultModelRow } from './DefaultModelRow'
import { ActionRow, SelectRow, SettingsGroup, ToggleRow, settingsButtonClassNames } from './SettingRows'
import type { UpdateAppSetting } from './useAppSettings'
import type { SettingsValues, UpdateSetting } from './useSettingsState'

interface SectionProps {
  settingsValues: SettingsValues
  updateSetting: UpdateSetting
  /**
   * True in the browser preview: also show the design's controls that have no backend
   * yet (model fallback). The desktop app hides them.
   */
  showsPreviewOnlySettings: boolean
}

/** Sections that also show desktop preferences stored by the backend. */
interface AppSettingsSectionProps extends SectionProps {
  appSettings: AppSettings
  updateAppSetting: UpdateAppSetting
}

type MissedRunPolicyLabel = (typeof missedRunPolicyLabels)[MissedRunPolicy]
const missedRunPolicyOptions = Object.values(missedRunPolicyLabels)

function findMissedRunPolicy(label: MissedRunPolicyLabel): MissedRunPolicy {
  return label === missedRunPolicyLabels.skip ? 'skip' : 'run_once'
}

/** Runner group: login item, menu bar, keep awake, missed runs and model choices. */
export function RunnerSection({ settingsValues, updateSetting, showsPreviewOnlySettings, appSettings, updateAppSetting }: AppSettingsSectionProps) {
  return (
    <SettingsGroup headingId="settings-runner-heading" title="Runner">
      <ToggleRow
        title="Start graphrt when I log in"
        description="So scheduled agents run without opening the app"
        isChecked={appSettings.openAtLogin}
        onToggle={(isChecked) => void updateAppSetting('openAtLogin', isChecked)}
      />
      <ToggleRow
        title={`Show in the ${getTrayAreaName()}`}
        description="Approve and check runs without opening the window"
        isChecked={appSettings.showInMenuBar}
        onToggle={(isChecked) => void updateAppSetting('showInMenuBar', isChecked)}
      />
      <ToggleRow
        title="Keep the computer awake while an agent runs"
        description={appSettings.keepAwakeOnlyOnPower ? 'Only while plugged in' : 'Also on battery'}
        isChecked={appSettings.keepAwakeWhileRunning}
        onToggle={(isChecked) => void updateAppSetting('keepAwakeWhileRunning', isChecked)}
      />
      {appSettings.keepAwakeWhileRunning && (
        <ToggleRow
          title="Only while plugged in"
          description="On battery the computer sleeps as usual"
          isChecked={appSettings.keepAwakeOnlyOnPower}
          onToggle={(isChecked) => void updateAppSetting('keepAwakeOnlyOnPower', isChecked)}
        />
      )}
      <SelectRow
        title="If a scheduled run was missed"
        description="Default for new schedules, when the computer was asleep or off"
        value={missedRunPolicyLabels[appSettings.missedRunDefaultPolicy]}
        options={missedRunPolicyOptions}
        onSelect={(label) => void updateAppSetting('missedRunDefaultPolicy', findMissedRunPolicy(label))}
        hasDivider
      />
      <DefaultModelRow />
      {showsPreviewOnlySettings && (
        <SelectRow
          title="If the main model fails"
          description="Out of credit, rate limited or offline"
          value={settingsValues.modelFallback}
          options={modelFallbackOptions}
          onSelect={(fallback) => updateSetting('modelFallback', fallback)}
          hasDivider={false}
        />
      )}
    </SettingsGroup>
  )
}

type FolderActionState = { kind: 'idle' } | { kind: 'revealed' } | { kind: 'failed'; message: string }

/** Retention choices, plus the stored value when it is not one of them. */
function listRetentionLabels(storedDays: number | null): string[] {
  const choices = runHistoryRetentionChoices.includes(storedDays) ? runHistoryRetentionChoices : [storedDays, ...runHistoryRetentionChoices]
  return choices.map(describeRetention)
}

function findRetentionDays(label: string, storedDays: number | null): number | null {
  const knownChoices = [storedDays, ...runHistoryRetentionChoices]
  const matchingIndex = knownChoices.findIndex((days) => describeRetention(days) === label)
  // `find` cannot be used: null (forever) is a valid choice.
  return matchingIndex === -1 ? storedDays : knownChoices[matchingIndex]
}

interface PrivacySectionProps extends SectionProps {
  /** Null while the stored preferences load (the retention row waits for them). */
  appSettings: AppSettings | null
  updateAppSetting: UpdateAppSetting
  appInfo: AppInfo | null
  onDataDeleted: () => void
}

/** Privacy and data group: data folder, run history retention, crash reports, export and delete. */
export function PrivacySection({ appSettings, updateAppSetting, appInfo, onDataDeleted }: PrivacySectionProps) {
  const [folderAction, setFolderAction] = useState<FolderActionState>({ kind: 'idle' })

  async function handleReveal() {
    try {
      await revealDataFolder()
      setFolderAction({ kind: 'revealed' })
    } catch (revealError) {
      setFolderAction({ kind: 'failed', message: `Could not open the data folder: ${describeError(revealError)}` })
    }
  }

  return (
    <SettingsGroup headingId="settings-privacy-heading" title="Privacy and data">
      <ActionRow
        title="Data folder"
        description={appInfo?.dataFolderPath ?? 'Loading…'}
        isMonospace
        action={
          <button type="button" onClick={() => void handleReveal()} className={`${settingsButtonClassNames} h-[34px] rounded-lg px-3`}>
            Show in {getFileManagerName()}
          </button>
        }
      />
      {appSettings && (
        <SelectRow
          title="Keep run history for"
          description="Step-by-step logs of finished runs; their results are kept"
          value={describeRetention(appSettings.runHistoryRetentionDays)}
          options={listRetentionLabels(appSettings.runHistoryRetentionDays)}
          onSelect={(label) => void updateAppSetting('runHistoryRetentionDays', findRetentionDays(label, appSettings.runHistoryRetentionDays))}
        />
      )}
      <CrashReportsPanel />
      {folderAction.kind === 'revealed' && (
        <p role="status" className="m-0 text-[13px] text-body">
          Opened the data folder in {getFileManagerName()}
        </p>
      )}
      {folderAction.kind === 'failed' && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {folderAction.message}
        </p>
      )}
      <DataActions onDataDeleted={onDataDeleted} />
    </SettingsGroup>
  )
}

/** Dark promo card pointing people at running graphrt on their own server (browser preview only). */
export function RemoteRunnerBanner({ onConnectServer }: { onConnectServer: () => void }) {
  return (
    <section aria-labelledby="settings-remote-banner-heading" className="flex flex-wrap items-center gap-4 rounded-[14px] bg-ink p-[18px] text-white">
      <span className="flex flex-[1_1_280px] flex-col gap-1">
        <h2 id="settings-remote-banner-heading" className="m-0 text-[15px] font-semibold">
          Free, no limits
        </h2>
        <span className="text-[13px] text-line-heavy">
          Want agents running when your computer is off? Install graphrt on your own server or VPS and connect it here
        </span>
      </span>
      <button
        type="button"
        onClick={onConnectServer}
        className="h-[38px] cursor-pointer rounded-[9px] border-0 bg-surface px-4 font-sans text-[13px] font-semibold text-ink"
      >
        Connect a server
      </button>
    </section>
  )
}

/** Remote runner group (browser preview only: no remote runner exists yet). */
export function RemoteRunnerSection({ settingsValues, updateSetting }: SectionProps) {
  const [connectedServerUrl, setConnectedServerUrl] = useState<string | null>(null)
  const trimmedServerUrl = settingsValues.remoteServerUrl.trim()

  function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (trimmedServerUrl) setConnectedServerUrl(trimmedServerUrl)
  }

  return (
    <SettingsGroup headingId="settings-remote-heading" title="Remote runner">
      <p className="m-0 leading-normal text-body">
        Run <code className="font-mono text-[13px]">npx graphrt runner</code> on your server, then paste the address it prints. Agents keep running when this computer is off
      </p>
      <form onSubmit={handleConnect} className="flex flex-wrap items-end gap-2 py-3.5">
        <label className="flex flex-[1_1_280px] flex-col gap-1.5">
          <span className="font-medium">Server address</span>
          <input
            type="url"
            value={settingsValues.remoteServerUrl}
            onChange={(event) => updateSetting('remoteServerUrl', event.target.value)}
            placeholder="https://runner.example.com"
            className="h-9 rounded-[9px] border border-line-strong bg-surface px-2.5 font-sans text-[14px] text-ink"
          />
        </label>
        <button
          type="submit"
          disabled={!trimmedServerUrl}
          className="h-9 cursor-pointer rounded-[9px] border-0 bg-ink px-4 font-sans text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Connect
        </button>
      </form>
      {connectedServerUrl && (
        <p role="status" className="m-0 text-[13px] text-ok-strong">
          Connected to {connectedServerUrl}. New runs can use this server
        </p>
      )}
    </SettingsGroup>
  )
}

/** General group: appearance and language (browser preview only: no dark theme or translations yet). */
export function GeneralSection({ settingsValues, updateSetting }: SectionProps) {
  return (
    <SettingsGroup headingId="settings-general-heading" title="General">
      <SelectRow
        title="Appearance"
        value={settingsValues.appearance}
        options={appearanceOptions}
        onSelect={(appearance) => updateSetting('appearance', appearance)}
      />
      <SelectRow
        title="Language"
        description="Used for the app and for messages agents write"
        value={settingsValues.language}
        options={languageOptions}
        onSelect={(language) => updateSetting('language', language)}
        hasDivider={false}
      />
    </SettingsGroup>
  )
}

/** Notifications group: which events show a system notification (all stored by the backend). */
export function NotificationsSection({ appSettings, updateAppSetting }: AppSettingsSectionProps) {
  return (
    <SettingsGroup headingId="settings-notifications-heading" title="Notifications">
      <ToggleRow
        title="An agent needs my approval"
        description="Before it sends a message or spends money"
        isChecked={appSettings.notifyOnApproval}
        onToggle={(isChecked) => void updateAppSetting('notifyOnApproval', isChecked)}
      />
      <ToggleRow
        title="A run fails"
        description="With one button that fixes it"
        isChecked={appSettings.notifyOnFailure}
        onToggle={(isChecked) => void updateAppSetting('notifyOnFailure', isChecked)}
      />
      <ToggleRow
        title="A chatbot conversation needs me"
        description="When a chatbot hands a customer chat over to you"
        isChecked={appSettings.notifyOnChatHandoff}
        onToggle={(isChecked) => void updateAppSetting('notifyOnChatHandoff', isChecked)}
      />
      <ToggleRow
        title="Daily summary at 18:00"
        description="How many runs succeeded or failed in the last 24 hours"
        isChecked={appSettings.notifyDailySummary}
        onToggle={(isChecked) => void updateAppSetting('notifyDailySummary', isChecked)}
        hasDivider={false}
      />
    </SettingsGroup>
  )
}

/** "Show the tour again", when the app's tour provider is there (hidden otherwise). */
function TourRow() {
  const onboardingTour = useOnboardingTour()
  if (!onboardingTour) return null
  return (
    <ActionRow
      title="Onboarding tour"
      description="A short walk through what graphrt does and where things are"
      action={
        <button type="button" onClick={onboardingTour.openTour} className={`${settingsButtonClassNames} h-[34px]`}>
          Show the tour again
        </button>
      }
    />
  )
}

/** "Developer mode": unlocks sideloading on the Plugins page; waits for the stored preferences. */
function DeveloperModeRow({ appSettings, updateAppSetting }: { appSettings: AppSettings | null; updateAppSetting: UpdateAppSetting }) {
  if (!appSettings) return null
  return (
    <ToggleRow
      title="Developer mode"
      description="Adds “Install from folder or archive…” on the Plugins page, for plugins you build yourself. They are not reviewed, start untrusted and never update by themselves"
      isChecked={appSettings.developerMode}
      onToggle={(isChecked) => void updateAppSetting('developerMode', isChecked)}
      hasDivider={false}
    />
  )
}

interface AboutSectionProps {
  appInfo: AppInfo | null
  /** Null while the stored preferences load (Developer mode waits for them). */
  appSettings: AppSettings | null
  updateAppSetting: UpdateAppSetting
}

/** About group: version, the onboarding tour, helpful links and Developer mode. */
export function AboutSection({ appInfo, appSettings, updateAppSetting }: AboutSectionProps) {
  const versionText = appInfo ? `Version ${appInfo.version}${appInfo.updateStatus ? ` · ${appInfo.updateStatus}` : ''}` : 'Loading…'
  return (
    <SettingsGroup headingId="settings-about-heading" title="About">
      <ActionRow title="graphrt" description={versionText} action={null} />
      <TourRow />
      <ActionRow
        title="Connected accounts"
        description="AI model keys, secrets and MCP servers"
        action={
          <Link to={connectionsTabPath('models')} className={`${settingsButtonClassNames} inline-flex h-[34px] items-center rounded-lg px-3 no-underline !text-ink`}>
            Open Connections
          </Link>
        }
      />
      <DeveloperModeRow appSettings={appSettings} updateAppSetting={updateAppSetting} />
    </SettingsGroup>
  )
}
