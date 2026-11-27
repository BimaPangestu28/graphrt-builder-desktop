import { useState } from 'react'
import { joinClassNames } from '@/components/ui'
import { supportedLocales, type Locale } from '@/i18n/types'
import { useLocale, useT } from '@/i18n'
import { saveLocale } from '@/i18n/persistLocale'

const shortLabels: Record<Locale, string> = { en: 'EN', id: 'ID' }
const fullNames: Record<Locale, string> = { en: 'English', id: 'Bahasa Indonesia' }

interface LanguageToggleProps {
  /** Shows the full language names ("English", "Bahasa Indonesia") instead of "EN" / "ID". */
  showFullNames?: boolean
  className?: string
}

/**
 * EN / ID switch: changes the UI language right away and stores it in the app settings. The
 * language names stay in their own language so anyone can find theirs.
 */
export function LanguageToggle({ showFullNames = false, className }: LanguageToggleProps) {
  const t = useT()
  const locale = useLocale()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  function choose(nextLocale: Locale) {
    if (nextLocale === locale) return
    setErrorMessage(null)
    saveLocale(nextLocale).catch((saveError: unknown) => {
      console.warn('Could not store the UI language', saveError)
      setErrorMessage(t.settings.languageSaveFailed)
    })
  }

  return (
    <div className={joinClassNames('flex flex-col items-end gap-1', className)}>
      <div role="radiogroup" aria-label={t.settings.languageLabel} className="inline-flex rounded-full border border-line-strong bg-surface p-0.5">
        {supportedLocales.map((option) => {
          const isActive = option === locale
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isActive}
              lang={option}
              title={fullNames[option]}
              aria-label={fullNames[option]}
              onClick={() => choose(option)}
              className={joinClassNames(
                'h-7 cursor-pointer rounded-full border-0 px-3 font-sans text-[12px] font-semibold whitespace-nowrap',
                isActive ? 'bg-ink text-inverse' : 'bg-transparent text-ink-2 hover:bg-subtle',
              )}
            >
              {showFullNames ? fullNames[option] : shortLabels[option]}
            </button>
          )
        })}
      </div>
      {errorMessage && (
        <span role="alert" className="text-[12px] text-danger">
          {errorMessage}
        </span>
      )}
    </div>
  )
}
