import { StrokeIcon } from '@/components/ui'

/** Padlock line icon used next to "stays on this Mac" privacy notes (screens 01 and 05). */
export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <StrokeIcon size={size}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </StrokeIcon>
  )
}
