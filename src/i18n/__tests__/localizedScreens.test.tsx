import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '@/App'
import { resetSampleAppSettings, sampleAppSettingsBackend } from '@/api/sampleBackend/appSettings'
import { LocaleRoot } from '../LocaleRoot'
import { setLocale } from '../locale'
import { detectSystemLocale } from '../locale'
import type { Locale } from '../types'

/** The main screens render in both languages: their headings and the sidebar change with the language. */

interface ScreenExpectation {
  path: string
  heading: Record<Locale, string | RegExp>
}

const screens: ScreenExpectation[] = [
  { path: '/welcome', heading: { en: 'Welcome to graphrt', id: 'Selamat datang di Graphrt' } },
  { path: '/new', heading: { en: 'What should your agent do?', id: 'Agent kamu mau mengerjakan apa?' } },
  { path: '/home', heading: { en: /^Good (morning|afternoon|evening)$/, id: /^Selamat (pagi|siang|malam)$/ } },
  { path: '/knowledge', heading: { en: 'Knowledge', id: 'Pengetahuan' } },
  { path: '/plugins', heading: { en: 'Plugins', id: 'Plugin' } },
  { path: '/settings', heading: { en: 'Settings', id: 'Pengaturan' } },
  { path: '/inbox', heading: { en: 'Inbox', id: 'Kotak masuk' } },
  { path: '/runs', heading: { en: 'Runs', id: 'Riwayat run' } },
  { path: '/schedule', heading: { en: 'Schedule', id: 'Jadwal' } },
  { path: '/connections/models', heading: { en: 'Connections', id: 'Koneksi' } },
]

function renderApp(path: string) {
  return render(
    <LocaleRoot>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </LocaleRoot>,
  )
}

describe.each<Locale>(['en', 'id'])('screens in %s', (locale) => {
  beforeEach(() => {
    resetSampleAppSettings()
    setLocale(locale)
  })

  it.each(screens)('$path shows its heading in the language', async ({ path, heading }) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: heading[locale] })).toBeInTheDocument()
    if (path !== '/welcome' && path !== '/new') {
      const sidebar = screen.getByRole('navigation', { name: locale === 'en' ? 'Main' : 'Utama' })
      expect(sidebar).toHaveTextContent(locale === 'en' ? 'Connections' : 'Koneksi')
      expect(sidebar).toHaveTextContent(locale === 'en' ? 'New agent' : 'Agent baru')
    }
  })
})

describe('switching the language', () => {
  beforeEach(() => {
    resetSampleAppSettings()
    setLocale('en')
  })

  it('switches every screen from the Welcome toggle and stores the choice', async () => {
    renderApp('/welcome')
    await screen.findByRole('heading', { name: 'Welcome to graphrt' })
    fireEvent.click(screen.getByRole('radio', { name: 'Bahasa Indonesia' }))
    expect(await screen.findByRole('heading', { name: 'Selamat datang di Graphrt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mulai/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Bahasa Indonesia' })).toHaveAttribute('aria-checked', 'true')
    await vi.waitFor(async () => expect((await sampleAppSettingsBackend.getAppSettings()).language).toBe('id'))
  })

  it('uses the stored language over the system one when the app opens', async () => {
    const settings = await sampleAppSettingsBackend.getAppSettings()
    await sampleAppSettingsBackend.updateAppSettings({ ...settings, language: 'id' })
    renderApp('/knowledge')
    expect(await screen.findByRole('heading', { level: 1, name: 'Pengetahuan' })).toBeInTheDocument()
  })

  it('stores the system language on first launch', async () => {
    renderApp('/knowledge')
    await screen.findByRole('heading', { level: 1, name: 'Knowledge' })
    await vi.waitFor(async () => expect((await sampleAppSettingsBackend.getAppSettings()).language).toBe('en'))
  })

  it('formats numbers and dates for the language', async () => {
    const { formatNumber, formatMonthShort } = await import('../format')
    act(() => setLocale('id'))
    expect(formatNumber(1234567)).toBe('1.234.567')
    expect(formatMonthShort(new Date(2026, 11, 3))).toBe('Des')
    act(() => setLocale('en'))
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatMonthShort(new Date(2026, 11, 3))).toBe('Dec')
  })
})

describe('detectSystemLocale', () => {
  it('picks Indonesian for any id locale and English otherwise', () => {
    expect(detectSystemLocale(['id-ID', 'en-US'])).toBe('id')
    expect(detectSystemLocale(['id'])).toBe('id')
    expect(detectSystemLocale(['en-GB', 'id-ID'])).toBe('en')
    expect(detectSystemLocale(['ms-MY'])).toBe('en')
    expect(detectSystemLocale([])).toBe('en')
  })
})
