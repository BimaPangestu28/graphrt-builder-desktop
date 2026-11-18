/**
 * A connected service that needs the user's attention (an expired sign-in, a revoked token),
 * shown in Home's "Needs you" list with a button to Connections.
 */
export interface ConnectionReminder {
  id: string
  /** e.g. "Gmail sign-in expired". */
  title: string
  /** What it broke, e.g. "Morning email digest failed yesterday at 07:00". */
  detail: string
  /** Button text, e.g. "Reconnect Gmail". */
  actionLabel: string
}
