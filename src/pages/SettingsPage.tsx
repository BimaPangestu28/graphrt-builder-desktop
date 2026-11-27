import { useEffect, useState } from 'react'
import { getAppInfo } from '@/api/appInfo'
import { isDesktopApp } from '@/api/client'
import type { AppInfo } from '@/api/connectionTypes'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { listSettingsSections, previewOnlySettingsSections, type SettingsSectionKey } from '@/lib/settings'
import { useT } from '@/i18n'
import { useAsyncData } from '@/hooks/useAsyncData'
import {
  AboutSection,
  GeneralSection,
  NotificationsSection,
  PrivacySection,
  RemoteRunnerBanner,
  RemoteRunnerSection,
  RunnerSection,
} from './settings/SettingsSections'
import { PhoneAccessSection } from './settings/PhoneAccessSection'
import { TeamServerSection } from './settings/TeamServerSection'
import { PluginRuntimeSection } from './settings/PluginRuntimeSection'
import { RunLimitsPanel } from './settings/RunLimitsPanel'
import { UpdatesSection } from './settings/UpdatesSection'
import { useAppSettings, type AppSettingsState } from './settings/useAppSettings'
import { useSettingsState, type SettingsValues, type UpdateSetting } from './settings/useSettingsState'
import { forgetSectionAfterLanguageSwitch, sectionToOpen } from './settings/languageSwitch'

interface SettingsSubNavProps {
  sections: ReturnType<typeof listSettingsSections>
  activeSection: SettingsSectionKey
  onSelectSection: (section: SettingsSectionKey) => void
}

function SettingsSubNav({ sections, activeSection, onSelectSection }: SettingsSubNavProps) {
  const t = useT().settings
  return (
    <nav
      aria-label={t.sectionsLabel}
      className="-ml-2.5 box-border flex min-w-0 flex-[0_1_200px] flex-col gap-0.5"
    >
      {sections.map((section) => {
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
  showsPreviewOnlySettings: boolean
  appSettingsState: AppSettingsState
  appInfo: AppInfo | null
  onSelectSection: (section: SettingsSectionKey) => void
}

/** Shown in place of the sections that need the stored desktop preferences until they load. */
function AppSettingsPlaceholder({ appSettingsState }: { appSettingsState: AppSettingsState }) {
  const t = useT().settings
  if (appSettingsState.loadError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-danger">
        {t.couldNotLoad(appSettingsState.loadError.message)}
        <button type="button" onClick={() => void appSettingsState.reload()} className="cursor-pointer rounded-[9px] border border-line-strong bg-surface px-3 py-1.5 font-sans text-[13px] text-ink">
          {t.tryAgain}
        </button>
      </div>
    )
  }
  return (
    <p role="status" className="m-0 text-[13px] text-muted">
      {t.loading}
    </p>
  )
}

/**
 * The Runner tab is the overview from the design: runner options, privacy and (in the
 * browser preview) the remote runner promo. Every other tab shows only its own group.
 */
function SettingsSectionContent({ activeSection, onSelectSection, appSettingsState, appInfo, ...sectionProps }: SettingsSectionContentProps) {
  const { appSettings, updateAppSetting, reload } = appSettingsState
  const privacySection = (
    <PrivacySection {...sectionProps} appSettings={appSettings} updateAppSetting={updateAppSetting} appInfo={appInfo} onDataDeleted={() => void reload()} />
  )
  switch (activeSection) {
    case 'general':
      return <GeneralSection {...sectionProps} appSettings={appSettings} />
    case 'notifications':
      if (!appSettings) return <AppSettingsPlaceholder appSettingsState={appSettingsState} />
      return <NotificationsSection {...sectionProps} appSettings={appSettings} updateAppSetting={updateAppSetting} />
    case 'phone':
      return <PhoneAccessSection />
    case 'team':
      return <TeamServerSection />
    case 'privacy':
      return privacySection
    case 'remote':
      return <RemoteRunnerSection {...sectionProps} />
    case 'updates':
      return <UpdatesSection appSettings={appSettings} updateAppSetting={updateAppSetting} fallbackVersion={appInfo?.version ?? null} />
    case 'about':
      return <AboutSection appInfo={appInfo} appSettings={appSettings} updateAppSetting={updateAppSetting} />
    case 'runner':
      return (
        <>
          {appSettings ? (
            <>
              <RunnerSection {...sectionProps} appSettings={appSettings} updateAppSetting={updateAppSetting} />
              <RunLimitsPanel key={JSON.stringify(appSettings.runLimits)} runLimits={appSettings.runLimits} onSave={(runLimits) => void updateAppSetting('runLimits', runLimits)} />
            </>
          ) : (
            <AppSettingsPlaceholder appSettingsState={appSettingsState} />
          )}
          <PluginRuntimeSection />
          {privacySection}
          {sectionProps.showsPreviewOnlySettings && <RemoteRunnerBanner onConnectServer={() => onSelectSection('remote')} />}
        </>
      )
  }
}

/**
 * Screen 22 · Settings.
 * App-wide preferences with an inner sub-nav (General, Runner, Notifications, Phone access, Privacy and data,
 * Remote runner, Updates, About). Opens on Runner, matching the design. Launch at login, menu bar,
 * keep awake, missed runs, notifications and run history retention are saved by the backend
 * on every change; the default model through the credentials commands; crash reports and
 * their sharing opt-in through the crash report commands. Controls without a
 * backend (appearance, language, model fallback, remote runner) are shown
 * only in the browser preview, so the desktop app never offers a switch that does nothing.
 */
export function SettingsPage() {
  const t = useT().settings
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>(sectionToOpen)
  useEffect(forgetSectionAfterLanguageSwitch, [])
  const { settingsValues, updateSetting } = useSettingsState()
  const appSettingsState = useAppSettings()
  const { data: appInfo } = useAsyncData(getAppInfo, [])
  const showsPreviewOnlySettings = !isDesktopApp()
  const settingsSections = listSettingsSections()
  const visibleSections = showsPreviewOnlySettings ? settingsSections : settingsSections.filter((section) => !previewOnlySettingsSections.includes(section.key))

  return (
    <AppShell activeNav="settings" agents={{ kind: 'list' }}>
      <PageFrame>
        <PageTitleBlock title={t.title} subtitle={t.subtitle} />
        <div className="flex flex-wrap items-start gap-x-10 gap-y-6">
          <SettingsSubNav sections={visibleSections} activeSection={activeSection} onSelectSection={setActiveSection} />
          <div className="box-border flex min-w-0 max-w-[760px] flex-[1_1_520px] flex-col gap-7">
            <SettingsSectionContent
              activeSection={activeSection}
              onSelectSection={setActiveSection}
              settingsValues={settingsValues}
              updateSetting={updateSetting}
              showsPreviewOnlySettings={showsPreviewOnlySettings}
              appSettingsState={appSettingsState}
              appInfo={appInfo}
            />
            {appSettingsState.saveError && (
              <p role="alert" className="m-0 text-[13px] text-danger">
                {t.couldNotSave(appSettingsState.saveError)}
              </p>
            )}
          </div>
        </div>
      </PageFrame>
    </AppShell>
  )
}
