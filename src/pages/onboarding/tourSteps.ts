import { connectionsTabPath, routePaths } from '@/routes'
import { getCredentialStoreName } from '@/lib/platform'

/**
 * Content of the onboarding tour, one entry per step, in order. Each line describes
 * something the app really does today; keep it in sync when a feature changes.
 */

export type TourStepId = 'how-it-works' | 'build-with-chat' | 'test-runs' | 'plugins' | 'secrets' | 'runs-schedule-inbox' | 'knowledge' | 'privacy'

export interface TourTryLink {
  label: string
  /** App route opened by the link; following it closes the tour. */
  path: string
}

export interface TourStep {
  id: TourStepId
  title: string
  /** One to three short sentences in plain language. */
  explanation: string
  tryLink?: TourTryLink
}

export const tourSteps: readonly TourStep[] = [
  {
    id: 'how-it-works',
    title: 'Welcome to graphrt',
    explanation:
      'Describe a job in plain words. The builder turns it into steps you can read, you test it, then put it on a schedule. Every agent runs right here on your computer.',
    tryLink: { label: 'Describe an agent', path: routePaths.newAgent },
  },
  {
    id: 'build-with-chat',
    title: 'Change it by chatting',
    explanation:
      'Want something different? Tell the builder in the chat next to your steps, like "also send me a summary". Your chat and every saved version are kept, and you can pick the model the builder uses from the chat header.',
  },
  {
    id: 'test-runs',
    title: 'Test before it runs for real',
    explanation:
      'A test run shows each step as it happens. A step like "Ask me before sending" pauses until you approve, edit or skip it. When a step drives a browser, you watch the page live.',
  },
  {
    id: 'plugins',
    title: 'Plugins',
    explanation:
      'Plugins add skills such as a Google Maps scraper or WhatsApp. Find them under Plugins in the sidebar: you approve each install and choose to trust it before it can run; WhatsApp links by scanning a QR code with your phone.',
    tryLink: { label: 'Browse plugins', path: routePaths.plugins },
  },
  {
    id: 'secrets',
    title: 'Your own secrets',
    explanation:
      `Add server logins and API tokens your agents need under Connections, on the Secrets tab. Values stay in ${getCredentialStoreName()}; the builder only ever sees their names.`,
    tryLink: { label: 'Open Secrets', path: connectionsTabPath('secrets') },
  },
  {
    id: 'runs-schedule-inbox',
    title: 'Runs, Schedule and Inbox',
    explanation:
      'Runs lists every run with its result. Schedule shows when each agent runs next. Inbox holds your chatbots’ conversations, including the ones handed over to you.',
    tryLink: { label: 'See runs', path: routePaths.runs },
  },
  {
    id: 'knowledge',
    title: 'Knowledge',
    explanation: 'Add files, folders and web links that your agents can search, like a menu or a price list, so their answers use your own facts.',
    tryLink: { label: 'Open Knowledge', path: routePaths.knowledge },
  },
  {
    id: 'privacy',
    title: 'It stays on your computer',
    explanation:
      `Agents, runs and documents are stored on this computer, keys and secrets in ${getCredentialStoreName()}. graphrt only connects to the AI providers you set up, the sites and apps your agents use, and the plugin catalog.`,
  },
]
