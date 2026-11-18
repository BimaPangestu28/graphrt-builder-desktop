/**
 * Mock batch for screen 19: the messages a scheduled "Maps leads to WhatsApp" run
 * wrote and is holding until the user approves them.
 */
export interface BatchMessage {
  id: string
  placeName: string
  placeKind: 'Office' | 'Cafe' | 'School' | 'Clinic'
  score: number
  message: string
}

/** Leads scoring below this are left unselected for the user to decide on. */
export const lowScoreThreshold = 5

/** WhatsApp messages the runner may still send today before the daily cap. */
export const dailySendLimit = 40

/** How many messages are shown before "Show N more". */
export const initiallyVisibleCount = 4

const officePitch = (placeName: string) =>
  `Halo tim ${placeName}, kami catering di Rajabasa. Untuk meeting atau acara kantor, boleh saya kirim menu nasi box kami?`
const cafePitch = (placeName: string) =>
  `Halo tim ${placeName}, kami catering di Rajabasa dan ingin supply snack untuk cafe Anda. Boleh saya kirim daftar harga?`

const placeSpecs: Array<Pick<BatchMessage, 'placeKind' | 'score'>> = [
  { placeKind: 'Office', score: 9 },
  { placeKind: 'Cafe', score: 8 },
  { placeKind: 'Office', score: 8 },
  { placeKind: 'Cafe', score: 4 },
  { placeKind: 'School', score: 8 },
  { placeKind: 'Office', score: 7 },
  { placeKind: 'Clinic', score: 7 },
  { placeKind: 'Cafe', score: 7 },
  { placeKind: 'Office', score: 6 },
  { placeKind: 'School', score: 6 },
  { placeKind: 'Office', score: 6 },
  { placeKind: 'Cafe', score: 5 },
]

export const batchMessages: BatchMessage[] = placeSpecs.map((placeSpec, index) => {
  const placeName = `[PLACE NAME ${index + 1}]`
  return {
    id: `place-${index + 1}`,
    placeName,
    ...placeSpec,
    message: placeSpec.placeKind === 'Cafe' ? cafePitch(placeName) : officePitch(placeName),
  }
})

/** Summary line under the page title. */
export const batchRunSummary = 'Maps leads to WhatsApp · weekday run today 09:00 · 3 places skipped, already messaged'
