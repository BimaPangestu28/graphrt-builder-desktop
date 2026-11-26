import { useState } from 'react'
import { getTrayAreaName } from '@/lib/platform'
import { systemNotifications } from '@/pages/menu-bar/menuBarIllustration'
import { MenuBarPopover } from '@/pages/menu-bar/MenuBarPopover'
import { SystemNotificationCard } from '@/pages/menu-bar/SystemNotificationCard'
import { messages } from '@/i18n'

function CanvasColumnLabel({ children }: { children: string }) {
  return <span className="text-[13px] font-semibold text-ink-2">{children}</span>
}

/**
 * Screen 25 · Menu bar and notifications.
 * A fixed 1440x900 illustration (centered, scrolls on smaller windows) of how graphrt lives in the
 * macOS menu bar: the popover with things that need you, the running agent and quick actions,
 * next to the system notifications it sends. Actions link into the app; "Pause all agents" toggles
 * and "In 1 hour" snoozes the review notification.
 */
export function MenuBarPage() {
  const [areAgentsPaused, setAreAgentsPaused] = useState(false)
  const [snoozedNotificationIds, setSnoozedNotificationIds] = useState<string[]>([])
  const visibleNotifications = systemNotifications.filter((notification) => !snoozedNotificationIds.includes(notification.id))

  const snoozeNotification = (notificationId: string) => setSnoozedNotificationIds((previousIds) => [...previousIds, notificationId])

  return (
    <div className="min-h-screen overflow-auto bg-[#E9E9EC]">
      <div className="mx-auto box-border flex h-[900px] w-[1440px] gap-16 p-16 text-[14px] text-ink">
        <div className="flex flex-[0_0_380px] flex-col gap-3">
          <CanvasColumnLabel>{getTrayAreaName() === 'menu bar' ? messages().misc.menuBarPopover : messages().misc.systemTrayMenu}</CanvasColumnLabel>
          <MenuBarPopover areAgentsPaused={areAgentsPaused} onTogglePause={() => setAreAgentsPaused((isPaused) => !isPaused)} />
        </div>

        <div className="flex flex-auto flex-col gap-3">
          <CanvasColumnLabel>{messages().misc.systemNotifications}</CanvasColumnLabel>
          <div className="flex w-[400px] flex-col gap-3">
            {visibleNotifications.map((notification) => (
              <SystemNotificationCard key={notification.id} notification={notification} onSnooze={snoozeNotification} />
            ))}
            {snoozedNotificationIds.length > 0 && (
              <p role="status" className="m-0 text-[13px] text-muted">
                {snoozedNotificationIds.length} {messages().misc.notificationSnoozedItComesBackIn}
              </p>
            )}
            <p className="mt-2 mb-0 leading-[1.6] text-ink-2">
              {messages().misc.onlyThingsThatNeedYouMake}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
