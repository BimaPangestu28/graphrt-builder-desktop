import { routePaths } from '@/routes'

/** Mock data for screen 25, the macOS menu bar popover and system notifications. */

export interface MenuBarAttentionItem {
  id: string
  title: string
  detail: string
  actionLabel: string
  actionPath: string
  tone: 'amber' | 'danger'
  isPrimaryAction: boolean
}

export const menuBarAttentionItems: MenuBarAttentionItem[] = [
  { id: 'review', title: '12 messages to review', detail: 'Maps leads to WhatsApp', actionLabel: 'Review', actionPath: routePaths.batchApproval, tone: 'amber', isPrimaryAction: true },
  { id: 'inbox', title: '2 customers waiting', detail: 'Catering assistant · oldest 9m', actionLabel: 'Open', actionPath: routePaths.inbox, tone: 'amber', isPrimaryAction: false },
  { id: 'gmail', title: 'Gmail signed out', detail: 'Morning email digest paused', actionLabel: 'Fix', actionPath: routePaths.connections, tone: 'danger', isPrimaryAction: false },
]

export const runningAgent = { name: 'Lead tracker', completedCount: 6, totalCount: 15 }

export const nextScheduledRun = { agentName: 'Morning email digest', startsAt: 'Tomorrow 07:00' }

export interface SystemNotification {
  id: string
  title: string
  body: string
  /** Only the review notification offers action buttons. */
  hasReviewActions: boolean
}

export const systemNotifications: SystemNotification[] = [
  { id: 'review-ready', title: '12 messages ready to review', body: 'Maps leads to WhatsApp finished searching', hasReviewActions: true },
  { id: 'order', title: '[CAFE NAME] wants to order', body: '50 × Paket Komplit, Friday 11:00. The bot is waiting for you to confirm', hasReviewActions: false },
  { id: 'digest-failed', title: 'Morning email digest could not run', body: 'Gmail signed out. Reconnect to run it again', hasReviewActions: false },
]
