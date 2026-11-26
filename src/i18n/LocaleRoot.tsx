import { Fragment, useEffect, type ReactNode } from 'react'
import { useLocale } from './index'
import { syncLocaleWithSettings } from './persistLocale'

/**
 * Loads the stored UI language once and re-mounts its children when the language changes, so
 * every screen (memoized parts and view models included) renders in the new language. The switch
 * happens on Settings or the first Welcome step, which reload their state anyway.
 */
export function LocaleRoot({ children }: { children: ReactNode }) {
  const locale = useLocale()
  useEffect(() => {
    void syncLocaleWithSettings()
  }, [])
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return <Fragment key={locale}>{children}</Fragment>
}
