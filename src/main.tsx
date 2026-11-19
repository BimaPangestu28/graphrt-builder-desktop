import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { OpenRunNavigation } from './hooks/useOpenRunNavigation'
import { OnboardingTourProvider } from './pages/onboarding/OnboardingTourProvider'
import { AppUpdateProvider } from './pages/updates/AppUpdateProvider'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found in index.html')

createRoot(rootElement).render(
  <StrictMode>
    <HashRouter>
      <OpenRunNavigation />
      <AppUpdateProvider>
        <OnboardingTourProvider>
          <App />
        </OnboardingTourProvider>
      </AppUpdateProvider>
    </HashRouter>
  </StrictMode>,
)
