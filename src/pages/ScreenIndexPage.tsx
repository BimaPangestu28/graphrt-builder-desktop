import { Link } from 'react-router-dom'
import { LogoLockup } from '@/components/ui'
import { routePaths, type RouteKey } from '@/routes'

/** Every screen from the design canvas, for jumping around during review. Not part of the product flow. */
const screenList: Array<{ number: string; title: string; routeKey: RouteKey }> = [
  { number: '01', title: 'Welcome', routeKey: 'welcome' },
  { number: '02', title: 'New agent', routeKey: 'newAgent' },
  { number: '03', title: 'Building the agent', routeKey: 'generating' },
  { number: '04', title: 'Review and edit steps', routeKey: 'builder' },
  { number: '05', title: 'Connect WhatsApp', routeKey: 'connectWhatsApp' },
  { number: '06', title: 'Test run and approval', routeKey: 'testRun' },
  { number: '07', title: 'Test result', routeKey: 'runResult' },
  { number: '08', title: 'Schedule and activate', routeKey: 'scheduleAgent' },
  { number: '09', title: 'Home with active agents', routeKey: 'home' },
  { number: '10', title: 'Scheduler', routeKey: 'scheduler' },
  { number: '11', title: 'Chain agents', routeKey: 'chain' },
  { number: '12', title: 'Agent as a step', routeKey: 'agentAsStep' },
  { number: '13', title: 'Agent team', routeKey: 'team' },
  { number: '14', title: 'Chatbot setup', routeKey: 'chatbotSetup' },
  { number: '15', title: 'Inbox', routeKey: 'inbox' },
  { number: '16', title: 'Conversation and take over', routeKey: 'chatDetail' },
  { number: '17', title: 'Knowledge', routeKey: 'knowledge' },
  { number: '18', title: 'Knowledge base detail', routeKey: 'knowledgeDetail' },
  { number: '19', title: 'Review a scheduled run', routeKey: 'batchApproval' },
  { number: '20', title: 'Runs', routeKey: 'runs' },
  { number: '21', title: 'Connections', routeKey: 'connections' },
  { number: '22', title: 'Settings', routeKey: 'settings' },
  { number: '23', title: 'When something goes wrong', routeKey: 'errorStates' },
  { number: '24', title: 'Version history and undo', routeKey: 'versionHistory' },
  { number: '25', title: 'Menu bar and notifications', routeKey: 'menuBar' },
]

export function ScreenIndexPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <LogoLockup />
      <h1 className="m-0 text-[28px] font-semibold tracking-[-0.6px]">All screens</h1>
      <ol className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
        {screenList.map((screen) => (
          <li key={screen.routeKey}>
            <Link
              to={routePaths[screen.routeKey]}
              className="flex gap-3 rounded-xl border border-line bg-surface px-4 py-3 no-underline !text-ink hover:border-line-heavy"
            >
              <span className="w-6 text-muted tabular-nums">{screen.number}</span>
              {screen.title}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}
