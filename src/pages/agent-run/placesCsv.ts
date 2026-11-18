import type { RunResultTable } from './runResultSummary'

/**
 * Builds a CSV of the run result table (header, then one line per listed row) as a data URI,
 * so "Export CSV" works as a plain download link. Values are quoted and inner quotes doubled.
 *
 * @param table - The table shown on the run result screen (RunResultTable)
 * @returns A `data:text/csv` URI (string)
 *
 * @example
 * <a href={buildTableCsvHref(view.table)} download="run.csv">Export CSV</a>
 */
export function buildTableCsvHref(table: RunResultTable): string {
  const quoteCsvValue = (value: string) => `"${value.replaceAll('"', '""')}"`
  const csvRows = [table.columns, ...table.rows.map((row) => [...row.cells, row.status])]
  const csvText = csvRows.map((row) => row.map(quoteCsvValue).join(',')).join('\n')
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csvText)}`
}
