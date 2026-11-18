import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { joinClassNames } from './cn'

/**
 * Buttons from the mockup.
 * - primary: ink fill, white text (Build agent, Run test)
 * - secondary: white with a light border
 * - ghost: no border, used for quiet actions
 * - approve / danger: green and red fills for approval decisions
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'approve' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const variantClassNames: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-2 border border-ink',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-subtle',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-chip',
  approve: 'bg-ok text-white border border-ok hover:bg-ok-strong',
  danger: 'bg-surface text-danger border border-danger-line hover:bg-danger-tint',
}

const sizeClassNames: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg',
  md: 'h-10 px-4 text-[14px] rounded-[9px]',
  lg: 'h-11 px-5 text-[15px] rounded-[10px]',
}

export function buttonClassNames(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return joinClassNames(
    'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap cursor-pointer no-underline transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    variantClassNames[variant],
    sizeClassNames[size],
    extra,
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClassNames(variant, size, className)} {...rest} />
}

interface LinkButtonProps {
  to: string
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  children: ReactNode
}

/** A router link styled as a button, for actions that navigate to another screen. */
export function LinkButton({ to, variant = 'primary', size = 'md', className, children }: LinkButtonProps) {
  return (
    <Link to={to} className={buttonClassNames(variant, size, className)}>
      {children}
    </Link>
  )
}
