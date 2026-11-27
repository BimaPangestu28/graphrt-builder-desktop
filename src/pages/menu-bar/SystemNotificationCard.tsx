import { useNavigate } from 'react-router-dom'
import type { SystemNotification } from '@/pages/menu-bar/menuBarIllustration'
import { routePaths } from '@/routes'
import { messages } from '@/i18n'

/** App icon as macOS shows it in notifications: the tile mark without the loop's arrowhead. */
function NotificationAppIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
      <rect width="28" height="28" rx="8" fill="#18181B" />
      <path d="M20.5 10A7.5 7.5 0 1 0 21.5 15" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="14" cy="14" r="2.4" fill="#2DD4BF" />
    </svg>
  )
}

interface SystemNotificationCardProps {
  notification: SystemNotification
  /** Called by "In 1 hour" on notifications with review actions. */
  onSnooze: (notificationId: string) => void
}

/** One frosted macOS-style notification banner. */
export function SystemNotificationCard({ notification, onSnooze }: SystemNotificationCardProps) {
  const navigate = useNavigate()
  return (
    <article aria-label={notification.title} className="flex gap-3 rounded-2xl bg-surface/92 p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
      <NotificationAppIcon />
      <span className="flex flex-auto flex-col gap-1">
        <b className="font-semibold">{notification.title}</b>
        <span className="text-ink-2">{notification.body}</span>
        {notification.hasReviewActions && (
          <span className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={() => navigate(routePaths.batchApproval)}
              className="h-[30px] cursor-pointer rounded-lg border-0 bg-ink px-3 text-[12px] font-semibold text-inverse hover:bg-ink-2"
            >
              {messages().misc.review}
            </button>
            <button
              type="button"
              onClick={() => onSnooze(notification.id)}
              className="h-[30px] cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[12px] font-medium text-ink hover:bg-subtle"
            >
              {messages().misc.in1Hour}
            </button>
          </span>
        )}
      </span>
    </article>
  )
}
