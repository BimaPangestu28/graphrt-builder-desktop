import { twMerge } from 'tailwind-merge'

/**
 * Joins class names, skipping falsy values, and resolves Tailwind conflicts so the
 * later class wins. This lets pages override a shared component's defaults via `className`.
 *
 * @example
 * joinClassNames('px-2', isActive && 'bg-selected') // "px-2 bg-selected"
 * joinClassNames('h-10 font-semibold', 'h-9 font-medium') // "h-9 font-medium"
 */
export function joinClassNames(...classNames: Array<string | false | null | undefined>): string {
  return twMerge(classNames.filter(Boolean).join(' '))
}
