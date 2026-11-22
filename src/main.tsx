import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { AppErrorBoundary } from './components/errors/AppErrorBoundary'
import { OpenRunNavigation } from './hooks/useOpenRunNavigation'
import { installFrontendErrorReporting } from './lib/frontendErrorReporting'
import { CrashReportNotice } from './pages/crash-reports/CrashReportNotice'
import { OnboardingTourProvider } from './pages/onboarding/OnboardingTourProvider'
import { PluginRuntimeNotice } from './pages/plugins/PluginRuntimeNotice'
import { AppUpdateProvider } from './pages/updates/AppUpdateProvider'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found in index.html')

// Uncaught errors and unhandled rejections become local crash reports (never sent anywhere).
installFrontendErrorReporting()

createRoot(rootElement).render(
  <StrictMode>
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
  </StrictMode>,
)
