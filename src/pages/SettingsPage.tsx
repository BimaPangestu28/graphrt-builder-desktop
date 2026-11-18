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
  onSelectSection: (section: SettingsSectionKey) => void
}

/**
 * The Runner tab is the overview from the design: runner options, privacy and the
 * remote runner promo. Every other tab shows only its own group.
 */
function SettingsSectionContent({ activeSection, onSelectSection, ...sectionProps }: SettingsSectionContentProps) {
  switch (activeSection) {
    case 'general':
      return <GeneralSection {...sectionProps} />
    case 'notifications':
      return <NotificationsSection {...sectionProps} />
    case 'privacy':
      return <PrivacySection {...sectionProps} />
    case 'remote':
      return <RemoteRunnerSection {...sectionProps} />
    case 'about':
      return <AboutSection />
    case 'runner':
      return (
        <>
          <RunnerSection {...sectionProps} />
          <PrivacySection {...sectionProps} />
          <RemoteRunnerBanner onConnectServer={() => onSelectSection('remote')} />
        </>
      )
  }
}

/**
 * Screen 22 · Settings.
 * App-wide preferences with an inner sub-nav (General, Runner, Notifications, Privacy and data,
 * Remote runner, About). Opens on Runner, matching the design. All values are local state.
 */
export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>('runner')
  const { settingsValues, updateSetting } = useSettingsState()

  return (
    <AppShell activeNav="settings" agents={{ kind: 'list' }} mainClassName="flex flex-wrap">
      <SettingsSubNav activeSection={activeSection} onSelectSection={setActiveSection} />
      <div className="box-border flex min-w-0 max-w-[760px] flex-[1_1_520px] flex-col gap-7 px-9 py-7">
        <SettingsSectionContent
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          settingsValues={settingsValues}
          updateSetting={updateSetting}
        />
      </div>
    </AppShell>
  )
}
