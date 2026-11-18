/**
 * graphrt brand mark: an upward loop (automation that keeps going) with a teal agent core.
 * `variant="mono"` is the menu-bar version drawn in a single color.
 */
interface LogoMarkProps {
  size?: number
  variant?: 'tile' | 'mono'
  className?: string
}

export function LogoMark({ size = 28, variant = 'tile', className }: LogoMarkProps) {
  if (variant === 'mono') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className={className}>
        <path d="M21.5 8.5A9.5 9.5 0 1 0 23 16" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M19.6 18 23.1 14.3 26.4 18.2" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="14" cy="14" r="3" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className={className}>
      <rect width="28" height="28" rx="8" fill="#18181B" />
      <path d="M20.5 10A7.5 7.5 0 1 0 21.5 15" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M18.9 16.6 21.6 13.7 24.2 16.8" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="14" r="2.4" fill="#2DD4BF" />
    </svg>
  )
}

/** Logo mark plus the "graphrt" wordmark, as used at the top of the sidebar. */
export function LogoLockup({ markSize = 28, className }: { markSize?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className ?? ''}`}>
      <LogoMark size={markSize} />
      <span className="text-[18px] font-bold tracking-[-0.3px] text-ink">graphrt</span>
    </span>
  )
}
