import { useState } from 'react'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { settingsSections, type SettingsSectionKey } from '@/data/settings'
import {
  AboutSection,
  GeneralSection,
  NotificationsSection,
  PrivacySection,
  RemoteRunnerBanner,
  RemoteRunnerSection,
  RunnerSection,
} from './settings/SettingsSections'
import { useAppSettings, type AppSettingsState } from './settings/useAppSettings'
import { useSettingsState, type SettingsValues, type UpdateSetting } from './settings/useSettingsState'

interface SettingsSubNavProps {
  activeSection: SettingsSectionKey
  onSelectSection: (section: SettingsSectionKey) => void
}

function SettingsSubNav({ activeSection, onSelectSection }: SettingsSubNavProps) {
  return (
    <nav
      aria-label="Settings sections"
      className="box-border flex min-w-0 flex-[0_1_200px] flex-col gap-0.5 border-r border-line px-3 py-7"
    >
      <h1 className="m-0 px-2.5 pb-3 text-[20px] font-semibold">Settings</h1>
      {settingsSections.map((section) => {
        const isActive = section.key === activeSection
        return (
          <button
            key={section.key}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelectSection(section.key)}
            className={joinClassNames(
              'cursor-pointer rounded-lg border-0 px-2.5 py-2 text-left font-sans text-[14px]',
              isActive ? 'bg-selected font-semibold text-ink' : 'bg-transparent font-normal text-ink-2 hover:bg-subtle',
            )}
          >
            {section.label}
          </button>
        )
      })}
    </nav>
  )
}

interface SettingsSectionContentProps {
  activeSection: SettingsSectionKey
  settingsValues: SettingsValues
  updateSetting: UpdateSetting
  appSettingsState: AppSettingsState
  onSelectSection: (section: SettingsSectionKey) => void
}

/** Shown in place of the sections that need the stored desktop preferences until they load. */
function AppSettingsPlaceholder({ appSettingsState }: { appSettingsState: AppSettingsState }) {
  if (appSettingsState.loadError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-danger">
        Could not load your settings: {appSettingsState.loadError.message}
        <button type="button" onClick={() => void appSettingsState.reload()} className="cursor-pointer rounded-[9px] border border-line-strong bg-surface px-3 py-1.5 font-sans text-[13px] text-ink">
          Try again
        </button>
      </div>
    )
  }
  return (
    <p role="status" className="m-0 text-[13px] text-muted">
      Loading settings…
    </p>
  )
}

/**
 * The Runner tab is the overview from the design: runner options, privacy and the
 * remote runner promo. Every other tab shows only its own group.
 */
function SettingsSectionContent({ activeSection, onSelectSection, appSettingsState, ...sectionProps }: SettingsSectionContentProps) {
  const { appSettings, updateAppSetting, reload } = appSettingsState
  const privacySection = <PrivacySection {...sectionProps} onDataDeleted={() => void reload()} />
  switch (activeSection) {
    case 'general':
      return <GeneralSection {...sectionProps} />
    case 'notifications':
      if (!appSettings) return <AppSettingsPlaceholder appSettingsState={appSettingsState} />
      return <NotificationsSection {...sectionProps} appSettings={appSettings} updateAppSetting={updateAppSetting} />
    case 'privacy':
      return privacySection
    case 'remote':
      return <RemoteRunnerSection {...sectionProps} />
    case 'about':
      return <AboutSection />
    case 'runner':
      return (
        <>
          {appSettings ? (
            <RunnerSection {...sectionProps} appSettings={appSettings} updateAppSetting={updateAppSetting} />
          ) : (
            <AppSettingsPlaceholder appSettingsState={appSettingsState} />
          )}
          {privacySection}
          <RemoteRunnerBanner onConnectServer={() => onSelectSection('remote')} />
        </>
      )
  }
}

/**
 * Screen 22 · Settings.
 * App-wide preferences with an inner sub-nav (General, Runner, Notifications, Privacy and data,
 * Remote runner, About). Opens on Runner, matching the design. Launch at login, menu bar,
 * keep awake, missed runs and the approval/failure notifications are saved by the backend on
 * every change; the other values are local state until they get a backend.
 */
export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>('runner')
  const { settingsValues, updateSetting } = useSettingsState()
  const appSettingsState = useAppSettings()

  return (
    <AppShell activeNav="settings" agents={{ kind: 'list' }} mainClassName="flex flex-wrap">
      <SettingsSubNav activeSection={activeSection} onSelectSection={setActiveSection} />
      <div className="box-border flex min-w-0 max-w-[760px] flex-[1_1_520px] flex-col gap-7 px-9 py-7">
        <SettingsSectionContent
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          settingsValues={settingsValues}
          updateSetting={updateSetting}
          appSettingsState={appSettingsState}
        />
        {appSettingsState.saveError && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            Could not save the change: {appSettingsState.saveError}
          </p>
        )}
      </div>
    </AppShell>
  )
}
