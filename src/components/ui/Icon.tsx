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
  home: <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" />,
  inbox: <path d="M3 13l3-8h12l3 8v6a1 1 0 01-1 1H4a1 1 0 01-1-1zM3 13h5l1.5 2.5h5L16 13h5" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  book: <path d="M12 7a4 4 0 00-4-3H3v15h5a4 4 0 014 2M12 7a4 4 0 014-3h5v15h-5a4 4 0 00-4 2M12 7v14" />,
  puzzle: <path d="M5 6h4a2.5 2.5 0 015 0h5v5a2.5 2.5 0 010 5v4H5z" />,
  plug: <path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 01-12 0zM12 17v5" />,
  settings: (
    <>
      <path d="M9.9 5.1L10.4 2.5L13.6 2.5L14.1 5.1L15.4 5.6L17.5 4.2L19.8 6.5L18.4 8.6L18.9 9.9L21.5 10.4L21.5 13.6L18.9 14.1L18.4 15.4L19.8 17.5L17.5 19.8L15.4 18.4L14.1 18.9L13.6 21.5L10.4 21.5L9.9 18.9L8.6 18.4L6.5 19.8L4.2 17.5L5.6 15.4L5.1 14.1L2.5 13.6L2.5 10.4L5.1 9.9L5.6 8.6L4.2 6.5L6.5 4.2L8.6 5.6Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof icons

export function Icon({ name, ...props }: Omit<StrokeIconProps, 'children'> & { name: IconName }) {
  return <StrokeIcon {...props}>{icons[name]}</StrokeIcon>
}
