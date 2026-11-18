import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AppSettings } from '@/api/appSettingsTypes'
import type { MissedRunPolicy } from '@/api/types'
import {
  appVersion,
  appearanceOptions,
  dataFolderPath,
  defaultModelOptions,
  languageOptions,
  missedRunPolicyLabels,
  modelFallbackOptions,
  runHistoryRetentionOptions,
} from '@/data/settings'
import { routePaths } from '@/routes'
import { DataActions } from './DataActions'
import { ActionRow, SelectRow, SettingsGroup, ToggleRow, settingsButtonClassNames } from './SettingRows'
import type { UpdateAppSetting } from './useAppSettings'
import type { SettingsValues, UpdateSetting } from './useSettingsState'

interface SectionProps {
  settingsValues: SettingsValues
  updateSetting: UpdateSetting
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
export function RunnerSection({ settingsValues, updateSetting, appSettings, updateAppSetting }: AppSettingsSectionProps) {
  return (
    <SettingsGroup headingId="settings-runner-heading" title="Runner">
      <ToggleRow
        title="Start graphrt when I log in"
        description="So scheduled agents run without opening the app"
        isChecked={appSettings.openAtLogin}
        onToggle={(isChecked) => void updateAppSetting('openAtLogin', isChecked)}
      />
      <ToggleRow
        title="Show in the menu bar"
        description="Approve and check runs without opening the window"
        isChecked={appSettings.showInMenuBar}
        onToggle={(isChecked) => void updateAppSetting('showInMenuBar', isChecked)}
      />
      <ToggleRow
        title="Keep the Mac awake while an agent runs"
        description={appSettings.keepAwakeOnlyOnPower ? 'Only while plugged in' : 'Also on battery'}
        isChecked={appSettings.keepAwakeWhileRunning}
        onToggle={(isChecked) => void updateAppSetting('keepAwakeWhileRunning', isChecked)}
      />
      {appSettings.keepAwakeWhileRunning && (
        <ToggleRow
          title="Only while plugged in"
          description="On battery the Mac sleeps as usual"
          isChecked={appSettings.keepAwakeOnlyOnPower}
          onToggle={(isChecked) => void updateAppSetting('keepAwakeOnlyOnPower', isChecked)}
        />
      )}
      <SelectRow
        title="If a scheduled run was missed"
        description="Default for new schedules, when the Mac was asleep or off"
        value={missedRunPolicyLabels[appSettings.missedRunDefaultPolicy]}
        options={missedRunPolicyOptions}
        onSelect={(label) => void updateAppSetting('missedRunDefaultPolicy', findMissedRunPolicy(label))}
      />
      <SelectRow
        title="Default AI model for new agents"
        description="Each agent can still pick its own"
        value={settingsValues.defaultModel}
        options={defaultModelOptions}
        onSelect={(model) => updateSetting('defaultModel', model)}
      />
      <SelectRow
        title="If the main model fails"
        description="Out of credit, rate limited or offline"
        value={settingsValues.modelFallback}
        options={modelFallbackOptions}
        onSelect={(fallback) => updateSetting('modelFallback', fallback)}
        hasDivider={false}
      />
    </SettingsGroup>
  )
}

type PendingFolderAction = 'idle' | 'revealed'

/** Privacy and data group: data folder, retention, crash reports, export and delete. */
export function PrivacySection({ settingsValues, updateSetting, onDataDeleted }: SectionProps & { onDataDeleted: () => void }) {
  const [folderAction, setFolderAction] = useState<PendingFolderAction>('idle')

  return (
    <SettingsGroup headingId="settings-privacy-heading" title="Privacy and data">
      <ActionRow
        title="Data folder"
        description={dataFolderPath}
        isMonospace
        action={
          <button type="button" onClick={() => setFolderAction('revealed')} className={`${settingsButtonClassNames} h-[34px] rounded-lg px-3`}>
            Show in Finder
          </button>
        }
      />
      <SelectRow
        title="Keep run history for"
        value={settingsValues.runHistoryRetention}
        options={runHistoryRetentionOptions}
        onSelect={(retention) => updateSetting('runHistoryRetention', retention)}
      />
      <ToggleRow
        title="Share anonymous crash reports"
        description="Never includes messages, files or keys"
        isChecked={settingsValues.shareCrashReports}
        onToggle={(isChecked) => updateSetting('shareCrashReports', isChecked)}
      />
      {folderAction === 'revealed' && (
        <p role="status" className="m-0 text-[13px] text-body">
          Opened the data folder in Finder
        </p>
      )}
      <DataActions onDataDeleted={onDataDeleted} />
    </SettingsGroup>
  )
}

/** Dark promo card pointing people at running graphrt on their own server. */
export function RemoteRunnerBanner({ onConnectServer }: { onConnectServer: () => void }) {
  return (
    <section aria-labelledby="settings-remote-banner-heading" className="flex flex-wrap items-center gap-4 rounded-[14px] bg-ink p-[18px] text-white">
      <span className="flex flex-[1_1_280px] flex-col gap-1">
        <h2 id="settings-remote-banner-heading" className="m-0 text-[15px] font-semibold">
          Free, no limits
        </h2>
        <span className="text-[13px] text-line-heavy">
          Want agents running when the Mac is off? Install graphrt on your own server or VPS and connect it here
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

/** Remote runner group: a server address form with a mock "connected" result. */
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
        Run <code className="font-mono text-[13px]">npx graphrt runner</code> on your server, then paste the address it prints. Agents keep running when this Mac is off
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

/** General group: appearance and language. */
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

/** Notifications group: which events show a Mac notification. */
export function NotificationsSection({ settingsValues, updateSetting, appSettings, updateAppSetting }: AppSettingsSectionProps) {
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
        title="New chatbot conversations"
        description="When a customer messages the Catering assistant"
        isChecked={settingsValues.notifyNewChatMessages}
        onToggle={(isChecked) => updateSetting('notifyNewChatMessages', isChecked)}
      />
      <ToggleRow
        title="Daily summary at 18:00"
        isChecked={settingsValues.dailySummary}
        onToggle={(isChecked) => updateSetting('dailySummary', isChecked)}
        hasDivider={false}
      />
    </SettingsGroup>
  )
}

/** About group: version and helpful links. */
export function AboutSection() {
  return (
    <SettingsGroup headingId="settings-about-heading" title="About">
      <ActionRow title="graphrt" description={`Version ${appVersion} · up to date`} action={null} />
      <ActionRow
        title="Connected accounts"
        description="Gmail, WhatsApp, OpenAI and more"
        hasDivider={false}
        action={
          <Link to={routePaths.connections} className={`${settingsButtonClassNames} inline-flex h-[34px] items-center rounded-lg px-3 no-underline !text-ink`}>
            Open Connections
          </Link>
        }
      />
    </SettingsGroup>
  )
}
