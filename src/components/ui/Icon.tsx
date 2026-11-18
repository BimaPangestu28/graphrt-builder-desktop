import type { ReactNode } from 'react'

/**
 * Stroke icon wrapper matching the mockup's 24x24, 2px, round-cap line icons.
 * Pass raw SVG children (paths) for one-off icons, or use a named icon from `icons` below.
 *
 * @example
 * <StrokeIcon size={16}><path d="M12 5v14M5 12h14" /></StrokeIcon>
 * <Icon name="plus" size={16} />
 */
interface StrokeIconProps {
  size?: number
  strokeWidth?: number
  className?: string
  /** When set, the icon is announced to screen readers with this label; otherwise it is decorative. */
  label?: string
  children: ReactNode
}

export function StrokeIcon({ size = 16, strokeWidth = 2, className, label, children }: StrokeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {children}
    </svg>
  )
}

const icons = {
  plus: <path d="M12 5v14M5 12h14" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  monitor: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  play: <path d="M7 5v14l11-7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  undo: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" />,
  bell: <path d="M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4" />,
  file: (
    <>
      <path d="M14 3H6v18h12V7z" />
      <path d="M14 3v4h4" />
    </>
  ),
  upload: <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />,
  send: <path d="M4 12l16-8-6 16-3-7z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  link: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  refresh: <path d="M20 11a8 8 0 10-2 6M20 5v6h-6" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof icons

export function Icon({ name, ...props }: Omit<StrokeIconProps, 'children'> & { name: IconName }) {
  return <StrokeIcon {...props}>{icons[name]}</StrokeIcon>
}
