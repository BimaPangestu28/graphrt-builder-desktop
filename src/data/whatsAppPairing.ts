/**
 * Mock WhatsApp pairing code for screen 05. Draws a 21x21 QR-like pattern:
 * three finder squares in the corners, a quiet separator, and pseudo-random modules
 * that change with `refreshCount` so each refresh looks like a new code.
 */

export const qrCodeSize = 21

/** Seconds a pairing code stays valid, and what the design shows when the dialog opens. */
export const pairingCodeLifetimeSeconds = 60
export const initialSecondsUntilRefresh = 48

const finderOrigins: Array<[number, number]> = [
  [0, 0],
  [0, 14],
  [14, 0],
]

/** Whether a cell belongs to a 7x7 finder square, and if so whether it is dark. Null when outside every finder. */
function getFinderCellValue(row: number, column: number): boolean | null {
  for (const [originRow, originColumn] of finderOrigins) {
    const offsetY = row - originRow
    const offsetX = column - originColumn
    if (offsetY < 0 || offsetX < 0 || offsetY > 6 || offsetX > 6) continue
    const isBorder = offsetY === 0 || offsetY === 6 || offsetX === 0 || offsetX === 6
    const isCenter = offsetY >= 2 && offsetY <= 4 && offsetX >= 2 && offsetX <= 4
    return isBorder || isCenter
  }
  return null
}

function isSeparatorCell(row: number, column: number) {
  return row === 7 || column === 7 || (row === 13 && column < 8) || (column === 13 && row < 8)
}

/**
 * Returns the dark/light state of every cell, row by row.
 *
 * @param refreshCount - How many times the code has refreshed (number); 0 matches the design
 * @returns Array of `qrCodeSize * qrCodeSize` booleans, true for a dark module
 */
export function generatePairingCodeCells(refreshCount: number): boolean[] {
  const cells: boolean[] = []
  for (let row = 0; row < qrCodeSize; row++) {
    for (let column = 0; column < qrCodeSize; column++) {
      const finderValue = getFinderCellValue(row, column)
      if (finderValue !== null) cells.push(finderValue)
      else if (isSeparatorCell(row, column)) cells.push(false)
      else cells.push((row * 7 + column * 13 + row * column * 3 + refreshCount * 3) % 5 < 2)
    }
  }
  return cells
}

/**
 * Formats remaining seconds as m:ss.
 *
 * @example
 * formatCountdown(48) // "0:48"
 */
export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
