import { messages } from '@/i18n'

/**
 * A data key in the words of the app's language: the column of a list input and the fields of
 * an approval's data are named by keys such as `unit_price`, which the workflow or a plugin
 * chose. Common business keys have a translation ("harga satuan"); any other key is shown as
 * its own words ("delivery_window" becomes "delivery window").
 *
 * @param key - A record key, e.g. "unit_price", "unitPrice" or "Unit-Price" (string)
 * @returns The name in lower case (string)
 *
 * @example
 * fieldName('unit_price') // "unit price" in English, "harga satuan" in Indonesian
 */
export function fieldName(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .toLowerCase()
  const known: Readonly<Record<string, string>> = messages().agentRun.fieldNames
  return known[words.replace(/ /g, '_')] ?? words
}
