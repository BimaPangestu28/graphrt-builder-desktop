import type { HTMLAttributes } from 'react'
import { joinClassNames } from './cn'

/** White bordered card, 14px radius, as used for templates, steps and panels. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClassNames('rounded-[14px] border border-line bg-surface', className)} {...rest} />
}
