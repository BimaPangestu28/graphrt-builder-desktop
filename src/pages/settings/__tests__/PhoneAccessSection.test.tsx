import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addSamplePairedPhone, resetSamplePhoneAccess } from '@/api/sampleBackend/phoneAccess'
import { setLocale } from '@/i18n/locale'
import { PhoneAccessSection } from '../PhoneAccessSection'

let copiedTexts: string[] = []

beforeEach(() => {
  resetSamplePhoneAccess()
  copiedTexts = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => Promise.resolve(void copiedTexts.push(text)) } })
})

async function turnOn() {
  render(<PhoneAccessSection />)
  await userEvent.click(await screen.findByRole('checkbox', { name: /Let my phones connect/ }))
}

describe('PhoneAccessSection', () => {
  it('is off until turned on, and offers nothing to pair while off', async () => {
    render(<PhoneAccessSection />)
    expect(await screen.findByRole('checkbox', { name: /Let my phones connect/ })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Pair a phone' })).not.toBeInTheDocument()
    expect(screen.queryByText('Where is your phone?')).not.toBeInTheDocument()
  })

  it('serves on the Wi-Fi address once on, says there is no HTTPS and copies the address', async () => {
    await turnOn()
    expect(await screen.findByText('http://192.168.1.21:47613')).toBeInTheDocument()
    expect(screen.getByText('No HTTPS: no notifications')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /On the same Wi-Fi/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Copy address' }))
    expect(copiedTexts).toEqual(['http://192.168.1.21:47613'])
  })

  it('shows a one-time pairing code for a named phone, and the phone once it paired', async () => {
    await turnOn()
    await userEvent.click(await screen.findByRole('button', { name: 'Pair a phone' }))
    await userEvent.type(screen.getByLabelText('Name of the phone'), "Ana's phone")
    await userEvent.click(screen.getByRole('button', { name: 'Pair' }))
    expect(await screen.findByRole('img', { name: 'Pairing code' })).toBeInTheDocument()
    expect(screen.getByText(/works once, for 10 minutes/)).toBeInTheDocument()

    act(() => void addSamplePairedPhone("Ana's phone"))
    expect(await screen.findByText("Ana's phone was paired")).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Pairing code' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('removes a phone after a confirmation and lists it in the activity', async () => {
    addSamplePairedPhone('Work phone')
    await turnOn()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove phone' }))
    expect(await screen.findByText('Work phone was removed')).toBeInTheDocument()
    expect(screen.getByText('No phone is paired yet.')).toBeInTheDocument()
  })

  it('explains why Tailscale cannot be used yet', async () => {
    await turnOn()
    await userEvent.click(await screen.findByRole('radio', { name: /Anywhere, with Tailscale/ }))
    expect(await screen.findByText(/Tailscale is not installed on this computer\. Install it/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pair a phone' })).not.toBeInTheDocument()
  })

  it('takes a tunnel address only as https', async () => {
    await turnOn()
    await userEvent.click(await screen.findByRole('radio', { name: /Anywhere, with my own tunnel/ }))
    const input = screen.getByLabelText('Your tunnel’s address')
    await userEvent.type(input, 'http://agents.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/like https:\/\/agents\.example\.com/)
    await userEvent.clear(input)
    await userEvent.type(input, 'https://agents.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('https://agents.example.com')).toBeInTheDocument()
    expect(screen.getByText('HTTPS')).toBeInTheDocument()
  })

  it('speaks Indonesian', async () => {
    setLocale('id')
    render(<PhoneAccessSection />)
    expect(await screen.findByRole('checkbox', { name: /Izinkan ponsel saya terhubung/ })).toBeInTheDocument()
  })
})
