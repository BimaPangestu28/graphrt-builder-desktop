import { useState, type FormEvent } from 'react'
import { getFileManagerName, getTrayAreaName } from '@/lib/platform'
import { Link } from 'react-router-dom'
import { revealDataFolder } from '@/api/appInfo'
import type { AppSettings } from '@/api/appSettingsTypes'
import type { AppInfo } from '@/api/connectionTypes'
import type { MissedRunPolicy } from '@/api/types'
import { appearanceKeys, describeRetention, missedRunPolicyLabels, modelFallbackKeys, runHistoryRetentionChoices } from '@/lib/settings'
import { useLocale, useT } from '@/i18n'
import { saveLocale } from '@/i18n/persistLocale'
import type { Locale } from '@/i18n/types'
import { keepSectionAcrossLanguageSwitch } from './languageSwitch'
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

function findMissedRunPolicy(label: string): MissedRunPolicy {
  return label === missedRunPolicyLabels().skip ? 'skip' : 'run_once'
}

/** Runner group: login item, menu bar, keep awake, missed runs and model choices. */
export function RunnerSection({ settingsValues, updateSetting, showsPreviewOnlySettings, appSettings, updateAppSetting }: AppSettingsSectionProps) {
  const t = useT().settings
  const policyLabels = missedRunPolicyLabels()
  return (
    <SettingsGroup headingId="settings-runner-heading" title={t.runner}>
      <ToggleRow
        title={t.openAtLogin}
        description={t.openAtLoginHint}
        isChecked={appSettings.openAtLogin}
        onToggle={(isChecked) => void updateAppSetting('openAtLogin', isChecked)}
      />
      <ToggleRow
        title={t.showInTray(getTrayAreaName())}
        description={t.showInTrayHint}
        isChecked={appSettings.showInMenuBar}
        onToggle={(isChecked) => void updateAppSetting('showInMenuBar', isChecked)}
      />
      <ToggleRow
        title={t.keepAwake}
        description={appSettings.keepAwakeOnlyOnPower ? t.onlyPluggedIn : t.alsoOnBattery}
        isChecked={appSettings.keepAwakeWhileRunning}
        onToggle={(isChecked) => void updateAppSetting('keepAwakeWhileRunning', isChecked)}
      />
      {appSettings.keepAwakeWhileRunning && (
        <ToggleRow
          title={t.onlyPluggedIn}
          description={t.onBatterySleeps}
          isChecked={appSettings.keepAwakeOnlyOnPower}
          onToggle={(isChecked) => void updateAppSetting('keepAwakeOnlyOnPower', isChecked)}
        />
      )}
      <SelectRow
        title={t.missedRun}
        description={t.missedRunHint}
        value={policyLabels[appSettings.missedRunDefaultPolicy]}
        options={Object.values(policyLabels)}
        onSelect={(label) => void updateAppSetting('missedRunDefaultPolicy', findMissedRunPolicy(label))}
        hasDivider
      />
      <DefaultModelRow />
      {showsPreviewOnlySettings && (
        <SelectRow
          title={t.modelFails}
          description={t.modelFailsHint}
          value={t.modelFallbackOptions[settingsValues.modelFallback]}
          options={modelFallbackKeys.map((key) => t.modelFallbackOptions[key])}
          onSelect={(label) => updateSetting('modelFallback', modelFallbackKeys.find((key) => t.modelFallbackOptions[key] === label) ?? settingsValues.modelFallback)}
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
  const t = useT().settings
  const [folderAction, setFolderAction] = useState<FolderActionState>({ kind: 'idle' })

  async function handleReveal() {
    try {
      await revealDataFolder()
      setFolderAction({ kind: 'revealed' })
    } catch (revealError) {
      setFolderAction({ kind: 'failed', message: t.couldNotOpenDataFolder(describeError(revealError)) })
    }
  }

  return (
    <SettingsGroup headingId="settings-privacy-heading" title={t.sections.privacy}>
      <ActionRow
        title={t.dataFolder}
        description={appInfo?.dataFolderPath ?? t.loadingEllipsis}
        isMonospace
        action={
          <button type="button" onClick={() => void handleReveal()} className={`${settingsButtonClassNames} h-[34px] rounded-lg px-3`}>
            {t.showIn(getFileManagerName())}
          </button>
        }
      />
      {appSettings && (
        <SelectRow
          title={t.keepHistory}
          description={t.keepHistoryHint}
          value={describeRetention(appSettings.runHistoryRetentionDays)}
          options={listRetentionLabels(appSettings.runHistoryRetentionDays)}
          onSelect={(label) => void updateAppSetting('runHistoryRetentionDays', findRetentionDays(label, appSettings.runHistoryRetentionDays))}
        />
      )}
      <CrashReportsPanel />
      {folderAction.kind === 'revealed' && (
        <p role="status" className="m-0 text-[13px] text-body">
          {t.openedDataFolder(getFileManagerName())}
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
  const t = useT().settings
  return (
    <section aria-labelledby="settings-remote-banner-heading" className="flex flex-wrap items-center gap-4 rounded-[14px] bg-ink p-[18px] text-inverse">
      <span className="flex flex-[1_1_280px] flex-col gap-1">
        <h2 id="settings-remote-banner-heading" className="m-0 text-[15px] font-semibold">
          {t.freeNoLimits}
        </h2>
        <span className="text-[13px] text-line-heavy">{t.remoteBannerText}</span>
      </span>
      <button
        type="button"
        onClick={onConnectServer}
        className="h-[38px] cursor-pointer rounded-[9px] border-0 bg-surface px-4 font-sans text-[13px] font-semibold text-ink"
      >
        {t.connectServer}
      </button>
    </section>
  )
}

/** Remote runner group (browser preview only: no remote runner exists yet). */
export function RemoteRunnerSection({ settingsValues, updateSetting }: SectionProps) {
  const t = useT().settings
  const [connectedServerUrl, setConnectedServerUrl] = useState<string | null>(null)
  const trimmedServerUrl = settingsValues.remoteServerUrl.trim()

  function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (trimmedServerUrl) setConnectedServerUrl(trimmedServerUrl)
  }

  return (
    <SettingsGroup headingId="settings-remote-heading" title={t.sections.remote}>
      <p className="m-0 leading-normal text-body">
        {t.remoteRun} <code className="font-mono text-[13px]">npx graphrt runner</code> {t.remoteRunAfter}
      </p>
      <form onSubmit={handleConnect} className="flex flex-wrap items-end gap-2 py-3.5">
        <label className="flex flex-[1_1_280px] flex-col gap-1.5">
          <span className="font-medium">{t.serverAddress}</span>
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
          className="h-9 cursor-pointer rounded-[9px] border-0 bg-ink px-4 font-sans text-[13px] font-semibold text-inverse disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.connect}
        </button>
      </form>
      {connectedServerUrl && (
        <p role="status" className="m-0 text-[13px] text-ok-strong">
          {t.connectedTo(connectedServerUrl)}
        </p>
      )}
    </SettingsGroup>
  )
}

/** Language names stay in their own language, so anyone can find theirs. */
const languageNames: Record<Locale, string> = { en: 'English', id: 'Bahasa Indonesia' }
const localeOptions: readonly Locale[] = ['en', 'id']

function LanguageRow({ hasDivider }: { hasDivider: boolean }) {
  const t = useT().settings
  const locale = useLocale()
  const [saveError, setSaveError] = useState<string | null>(null)

  function selectLanguage(name: string) {
    const nextLocale = localeOptions.find((option) => languageNames[option] === name)
    if (!nextLocale || nextLocale === locale) return
    setSaveError(null)
    keepSectionAcrossLanguageSwitch('general')
    saveLocale(nextLocale).catch((saveFailure: unknown) => {
      console.warn('Could not store the UI language', saveFailure)
      setSaveError(t.languageSaveFailed)
    })
  }

  return (
    <>
      <SelectRow
        title={t.languageLabel}
        description={t.languageDescription}
        value={languageNames[locale]}
        options={localeOptions.map((option) => languageNames[option])}
        onSelect={selectLanguage}
        hasDivider={hasDivider}
      />
      {saveError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {saveError}
        </p>
      )}
    </>
  )
}

export function GeneralSection({ settingsValues, updateSetting }: SectionProps & { appSettings: AppSettings | null }) {
  const t = useT().settings
  return (
    <SettingsGroup headingId="settings-general-heading" title={t.sections.general}>
      <LanguageRow hasDivider />
      <SelectRow
        title={t.appearance}
        value={t.appearanceOptions[settingsValues.appearance]}
        options={appearanceKeys.map((key) => t.appearanceOptions[key])}
        onSelect={(label) => updateSetting('appearance', appearanceKeys.find((key) => t.appearanceOptions[key] === label) ?? settingsValues.appearance)}
        hasDivider={false}
      />
    </SettingsGroup>
  )
}

/** Notifications group: which events show a system notification (all stored by the backend). */
export function NotificationsSection({ appSettings, updateAppSetting }: AppSettingsSectionProps) {
  const t = useT().settings
  return (
    <SettingsGroup headingId="settings-notifications-heading" title={t.notifications}>
      <ToggleRow
        title={t.notifyApproval}
        description={t.notifyApprovalHint}
        isChecked={appSettings.notifyOnApproval}
        onToggle={(isChecked) => void updateAppSetting('notifyOnApproval', isChecked)}
      />
      <ToggleRow
        title={t.notifyFailure}
        description={t.notifyFailureHint}
        isChecked={appSettings.notifyOnFailure}
        onToggle={(isChecked) => void updateAppSetting('notifyOnFailure', isChecked)}
      />
      <ToggleRow
        title={t.notifyChat}
        description={t.notifyChatHint}
        isChecked={appSettings.notifyOnChatHandoff}
        onToggle={(isChecked) => void updateAppSetting('notifyOnChatHandoff', isChecked)}
      />
      <ToggleRow
        title={t.notifyDaily}
        description={t.notifyDailyHint}
        isChecked={appSettings.notifyDailySummary}
        onToggle={(isChecked) => void updateAppSetting('notifyDailySummary', isChecked)}
        hasDivider={false}
      />
    </SettingsGroup>
  )
}

/** "Show the tour again", when the app's tour provider is there (hidden otherwise). */
function TourRow() {
  const t = useT().settings
  const onboardingTour = useOnboardingTour()
  if (!onboardingTour) return null
  return (
    <ActionRow
      title={t.tour}
      description={t.tourHint}
      action={
        <button type="button" onClick={onboardingTour.openTour} className={`${settingsButtonClassNames} h-[34px]`}>
          {t.showTourAgain}
        </button>
      }
    />
  )
}

/** "Developer mode": unlocks sideloading on the Plugins page; waits for the stored preferences. */
function DeveloperModeRow({ appSettings, updateAppSetting }: { appSettings: AppSettings | null; updateAppSetting: UpdateAppSetting }) {
  const t = useT().settings
  if (!appSettings) return null
  return (
    <ToggleRow
      title={t.developerMode}
      description={t.developerModeHint}
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
  const t = useT().settings
  const versionText = appInfo ? `${t.version(appInfo.version)}${appInfo.updateStatus ? ` · ${appInfo.updateStatus}` : ''}` : t.loadingEllipsis
  return (
    <SettingsGroup headingId="settings-about-heading" title={t.about}>
      <ActionRow title={t.appName} description={versionText} action={null} />
      <TourRow />
      <ActionRow
        title={t.connectedAccounts}
        description={t.connectedAccountsHint}
        action={
          <Link to={connectionsTabPath('models')} className={`${settingsButtonClassNames} inline-flex h-[34px] items-center rounded-lg px-3 no-underline !text-ink`}>
            {t.openConnections}
          </Link>
        }
      />
      <DeveloperModeRow appSettings={appSettings} updateAppSetting={updateAppSetting} />
    </SettingsGroup>
  )
}
