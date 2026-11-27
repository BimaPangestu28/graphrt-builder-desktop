import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/** Light squares around the code: a camera needs them to find it. */
const quietZone = 4

/**
 * A QR code of `text`, drawn as one SVG path. Always dark on white, in both themes: a camera
 * reads contrast, not the app's colors.
 */
export function QrCode({ text, label, size = 208 }: { text: string; label: string; size?: number }) {
  const { path, cells } = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(text)
    code.make()
    const count = code.getModuleCount()
    const squares: string[] = []
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) squares.push(`M${column + quietZone} ${row + quietZone}h1v1h-1z`)
      }
    }
    return { path: squares.join(''), cells: count + quietZone * 2 }
  }, [text])
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${cells} ${cells}`} shapeRendering="crispEdges" className="rounded-lg">
      <rect width={cells} height={cells} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
