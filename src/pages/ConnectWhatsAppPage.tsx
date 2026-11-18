import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '@/components/ui'
import { useBrowserRuntime } from '@/hooks/useBrowserRuntime'
import { usePlugins } from '@/hooks/usePlugins'
import { agentPath, routePaths } from '@/routes'
import { BuilderBackdropSkeleton } from './connect-whatsapp/BuilderBackdropSkeleton'
import { BusinessApiSetup } from './connect-whatsapp/BusinessApiSetup'
import { PersonalWhatsAppSetup } from './connect-whatsapp/PersonalWhatsAppSetup'
import { WhatsAppOptionPicker, type WhatsAppConnectionOption } from './connect-whatsapp/WhatsAppOptionPicker'
import { LockIcon } from './agent-builder/LockIcon'

/** The chosen option's setup steps, both backed by graphrt plugins. */
function SelectedOptionSetup({ selectedOption }: { selectedOption: WhatsAppConnectionOption | null }) {
  const plugins = usePlugins()
  const browserRuntime = useBrowserRuntime()
  if (selectedOption === 'business') return <BusinessApiSetup plugins={plugins} />
  if (selectedOption === 'personal') return <PersonalWhatsAppSetup plugins={plugins} browserRuntime={browserRuntime} />
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-2">
      <LockIcon />
      Tokens stay in the keychain and the WhatsApp session stays on this computer
    </div>
  )
}

/**
 * Screen 05 · Connect WhatsApp. Modal opened from the builder's "Connect" button with two
 * options: the official WhatsApp Business API (`whatsapp-api` plugin: install, trust, token
 * and phone number ID, check connection) or a personal number linked by QR code
 * (`whatsapp-web` plugin: Terms of Service warning, install, trust, browser runtime, then a
 * browser window with the QR code). Close (or Escape) returns to the builder (04).
 */
export function ConnectWhatsAppPage() {
  const navigate = useNavigate()
  const { agentId } = useParams()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [selectedOption, setSelectedOption] = useState<WhatsAppConnectionOption | null>(null)
  // Back to the builder of the agent in the route (`/agents/:agentId/connect-whatsapp`).
  const closeDialog = useCallback(() => navigate(agentId ? agentPath('builder', agentId) : routePaths.home), [navigate, agentId])

  useEffect(() => {
    closeButtonRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDialog()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDialog])

  return (
    <div className="relative box-border flex min-h-screen w-full flex-wrap bg-canvas text-[14px] text-ink">
      <BuilderBackdropSkeleton />
      <div className="absolute inset-0 box-border flex items-center justify-center bg-[rgba(24,24,27,0.45)] p-6">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="wa-title"
          className="box-border flex max-h-full w-full max-w-[760px] flex-col gap-5 overflow-y-auto rounded-[20px] bg-surface p-8 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="wa-title" className="m-0 text-[24px] font-semibold">
              Connect WhatsApp
            </h2>
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Close"
              onClick={closeDialog}
              className="flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-canvas text-ink-2 hover:bg-selected"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <WhatsAppOptionPicker selectedOption={selectedOption} onSelect={setSelectedOption} />
          <SelectedOptionSetup selectedOption={selectedOption} />
        </section>
      </div>
    </div>
  )
}
