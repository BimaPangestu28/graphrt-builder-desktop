import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { noOnlineFeatures, type OnlineFeatures } from '@/api/deployTypes'
import { OnlineFeaturesForm } from '../OnlineFeaturesForm'
import { anyFeatureOn, isoFromMs, needsStorage, withFeatureChange, type FeaturesAvailability } from '../onlineFeatures'
import { QrCode } from '../QrCode'

function Form({ initial = noOnlineFeatures, availability, phoneWasOn }: { initial?: OnlineFeatures; availability?: FeaturesAvailability; phoneWasOn?: boolean }) {
  const [features, setFeatures] = useState(initial)
  return (
    <>
      <OnlineFeaturesForm value={features} onChange={setFeatures} providerName="Fly.io" availability={availability} phoneWasOn={phoneWasOn} />
      <output aria-label="Chosen">{JSON.stringify(features)}</output>
    </>
  )
}

const chosen = () => JSON.parse(screen.getByLabelText('Chosen').textContent ?? '{}') as OnlineFeatures

describe('online feature helpers', () => {
  it('turn notifications off with the phone page they arrive on', () => {
    const on = { ...noOnlineFeatures, phone: true, notifications: true, notifyEmail: 'ana@example.com' }
    expect(withFeatureChange(on, { phone: false }).notifications).toBe(false)
    expect(withFeatureChange(noOnlineFeatures, { notifications: true }).notifications).toBe(false)
    expect(withFeatureChange(on, { chat: true })).toMatchObject({ chat: true, phone: true, notifications: true })
  })

  it('know what costs storage and what is on', () => {
    expect(needsStorage(noOnlineFeatures)).toBe(false)
    expect(needsStorage({ ...noOnlineFeatures, chat: true, answerWhenTimeRunsOut: true })).toBe(false)
    expect(needsStorage({ ...noOnlineFeatures, phone: true })).toBe(true)
    expect(anyFeatureOn(noOnlineFeatures)).toBe(false)
    expect(anyFeatureOn({ ...noOnlineFeatures, answerWhenTimeRunsOut: true })).toBe(true)
    expect(isoFromMs(null)).toBeNull()
    expect(isoFromMs(0)).toBe('1970-01-01T00:00:00.000Z')
  })
})

describe('OnlineFeaturesForm', () => {
  it('starts with everything off and says the cost of the phone page before it is turned on', () => {
    render(<Form />)
    expect(screen.getByRole('checkbox', { name: /Chat page/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Follow it from your phone/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Keep waiting/ })).toBeChecked()
    expect(screen.getByText(/Fly\.io bills about US\$0\.15 a month for it/)).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Who may chat' })).not.toBeInTheDocument()
  })

  it('offers who may chat with the limits in plain words, and the website for the chat bubble', async () => {
    render(<Form />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Chat page/ }))
    const audience = screen.getByRole('radiogroup', { name: 'Who may chat' })
    expect(within(audience).getByRole('radio', { name: /Anyone with the link/ })).toBeChecked()
    expect(within(audience).getByText(/10 messages a minute per visitor, 120 for all visitors together/)).toBeInTheDocument()
    await userEvent.click(within(audience).getByRole('radio', { name: /Only people with the access key/ }))
    await userEvent.type(screen.getByLabelText(/Your website/), 'www.toko-kue.example')
    expect(chosen()).toMatchObject({ chat: true, chatAudience: 'key', embedSite: 'www.toko-kue.example' })
    // Words a business person knows: no flag or protocol names on screen.
    expect(document.body.textContent).not.toMatch(/CORS|--chat|--monitor|on_expire|origin/i)
  })

  it('asks for an email only with notifications, and drops them when the phone page goes off', async () => {
    render(<Form phoneWasOn />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Follow it from your phone/ }))
    expect(screen.queryByLabelText(/Your email address/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Notify my phone/ }))
    await userEvent.type(screen.getByLabelText(/Your email address/), 'ana@example.com')
    await userEvent.click(screen.getByRole('radio', { name: /Do what the agent says/ }))
    expect(chosen()).toMatchObject({ phone: true, notifications: true, notifyEmail: 'ana@example.com', answerWhenTimeRunsOut: true })
    await userEvent.click(screen.getByRole('checkbox', { name: /Follow it from your phone/ }))
    expect(chosen()).toMatchObject({ phone: false, notifications: false })
    expect(screen.getByText('Turning this off removes the paired phones and ends the storage cost.')).toBeInTheDocument()
  })

  it('says honestly when the installed tools are too old, and lets nothing be chosen', () => {
    render(<Form availability="needs_newer_tools" />)
    expect(screen.getByText(/need newer graphrt tools than this version of the app can download/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Chat page/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Follow it from your phone/ })).toBeDisabled()
  })

  it('asks to download the tools first when they are not there yet', () => {
    render(<Form availability="needs_tools" />)
    expect(screen.getByText('Download the graphrt tools first to choose these.')).toBeInTheDocument()
  })
})

describe('QrCode', () => {
  it('draws the text as dark squares on white with a quiet zone', () => {
    render(<QrCode text="https://menu.fly.dev/monitor/#pair=grd1.dev-1.secret" label="Pairing code" />)
    const code = screen.getByRole('img', { name: 'Pairing code' })
    const cells = Number(code.getAttribute('viewBox')?.split(' ')[2])
    expect(cells).toBeGreaterThanOrEqual(21 + 8)
    expect(code.querySelector('rect')).toHaveAttribute('fill', '#ffffff')
    const path = code.querySelector('path')?.getAttribute('d') ?? ''
    // The three finder patterns start at the corners, four cells in.
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true)
    expect(path.split('M').length).toBeGreaterThan(200)
    // The link is drawn, never written out next to the code.
    expect(code.textContent).toBe('')
  })

  it('draws another code for another text', () => {
    const { container, rerender } = render(<QrCode text="first" label="Code" />)
    const first = container.querySelector('path')?.getAttribute('d')
    rerender(<QrCode text="second" label="Code" />)
    expect(container.querySelector('path')?.getAttribute('d')).not.toBe(first)
  })
})
