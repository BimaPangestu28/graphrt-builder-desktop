import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { LocaleRoot } from './i18n/LocaleRoot'
import { AppErrorBoundary } from './components/errors/AppErrorBoundary'
import { OpenRunNavigation } from './hooks/useOpenRunNavigation'
import { startAppearance } from './lib/appearance'
import { installFrontendErrorReporting } from './lib/frontendErrorReporting'
import { CrashReportNotice } from './pages/crash-reports/CrashReportNotice'
import { OnboardingTourProvider } from './pages/onboarding/OnboardingTourProvider'
import { PluginRuntimeNotice } from './pages/plugins/PluginRuntimeNotice'
import { AppUpdateProvider } from './pages/updates/AppUpdateProvider'
// Geist ships with the app (variable weight, woff2): no render-blocking request to Google
// Fonts before the first paint, and the same typeface offline.
import '@fontsource-variable/geist'
import './index.css'

// Light or dark before the first paint: the operating system's choice unless Settings says otherwise.
startAppearance()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found in index.html')

// Uncaught errors and unhandled rejections become local crash reports (never sent anywhere).
installFrontendErrorReporting()

createRoot(rootElement).render(
  <StrictMode>
    <LocaleRoot>
      <AppErrorBoundary>
        <HashRouter>
          <OpenRunNavigation />
          <AppUpdateProvider>
            <OnboardingTourProvider>
              <App />
            </OnboardingTourProvider>
          </AppUpdateProvider>
          <CrashReportNotice />
          <PluginRuntimeNotice />
        </HashRouter>
      </AppErrorBoundary>
    </LocaleRoot>
  </StrictMode>,
)
