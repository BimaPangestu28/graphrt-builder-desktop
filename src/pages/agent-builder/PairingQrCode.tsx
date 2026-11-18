import { useMemo } from 'react'
import { generatePairingCodeCells } from '@/data/whatsAppPairing'

/** 252px QR code drawn as a 21-column grid of spans (screen 05). */
export function PairingQrCode({ refreshCount }: { refreshCount: number }) {
  const cells = useMemo(() => generatePairingCodeCells(refreshCount), [refreshCount])
  return (
    <div
      role="img"
      aria-label="QR code to link WhatsApp"
      className="box-border grid size-[252px] grid-cols-[repeat(21,minmax(0,1fr))] rounded-2xl border border-line bg-surface p-[21px]"
    >
      {cells.map((isDark, cellIndex) => (
        <span key={cellIndex} className={isDark ? 'bg-ink' : 'bg-transparent'} />
      ))}
    </div>
  )
}
