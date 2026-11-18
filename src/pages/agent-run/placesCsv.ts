import type { TestRunPlace } from '@/data/testRun'

/**
 * Builds a CSV of the listed places as a data URI, so "Export CSV" works as a plain download link.
 * Values are quoted and inner quotes doubled.
 *
 * @param places - Places shown in the result table (TestRunPlace[])
 * @returns A `data:text/csv` URI (string)
 *
 * @example
 * <a href={buildPlacesCsvHref(testRunPlaces)} download="run.csv">Export CSV</a>
 */
export function buildPlacesCsvHref(places: TestRunPlace[]): string {
  const quoteCsvValue = (value: string) => `"${value.replaceAll('"', '""')}"`
  const csvRows = [['Place', 'Phone', 'Status'], ...places.map((place) => [place.name, place.phone, place.outcome])]
  const csvText = csvRows.map((row) => row.map(quoteCsvValue).join(',')).join('\n')
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csvText)}`
}
