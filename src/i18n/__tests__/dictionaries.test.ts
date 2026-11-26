import { dictionaries } from '../messages'

type Leaf = { path: string; value: unknown }

function collectLeaves(node: unknown, path = ''): Leaf[] {
  if (typeof node === 'string' || typeof node === 'function') return [{ path, value: node }]
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) => collectLeaves(child, path ? `${path}.${key}` : key))
  }
  return [{ path, value: node }]
}

/** Calls a message function with sample arguments; returns null when the samples do not fit. */
function sampleText(message: (...args: never[]) => string): string | null {
  const samples: unknown[] = Array.from({ length: message.length }, () => 2)
  try {
    const text = (message as (...args: unknown[]) => unknown)(...samples)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

const english = collectLeaves(dictionaries.en)
const indonesian = collectLeaves(dictionaries.id)

describe('dictionaries', () => {
  it('have the same keys in English and Indonesian', () => {
    expect(indonesian.map((leaf) => leaf.path).sort()).toEqual(english.map((leaf) => leaf.path).sort())
  })

  it('have the same kind of value and the same parameters for every key', () => {
    const indonesianByPath = new Map(indonesian.map((leaf) => [leaf.path, leaf.value]))
    for (const { path, value } of english) {
      const translated = indonesianByPath.get(path)
      expect(typeof translated, path).toBe(typeof value)
      if (typeof value === 'function' && typeof translated === 'function') expect(translated.length, path).toBe(value.length)
    }
  })

  it('have no empty strings', () => {
    for (const { path, value } of [...english, ...indonesian]) {
      if (typeof value === 'string') expect(value.trim() === '' && value !== '', path).toBe(false)
    }
  })

  it('follow the Indonesian copy rules: no arrows, no semicolons, no colons before a word', () => {
    const offending = indonesian
      .map(({ path, value }) => ({ path, text: typeof value === 'string' ? value : typeof value === 'function' ? sampleText(value as () => string) : null }))
      .filter((entry): entry is { path: string; text: string } => entry.text !== null)
      .filter(({ text }) => /[→←↑↓⇒➜]|;|:\s/u.test(text))
      .map(({ path, text }) => `${path}: ${text}`)
    expect(offending).toEqual([])
  })

  it('write the brand as Graphrt in Indonesian', () => {
    const lowercaseBrand = indonesian
      .filter(({ value }) => typeof value === 'string' && /(^|[^\w./-])graphrt(?![\w.-])/.test(value))
      .map(({ path }) => path)
    expect(lowercaseBrand).toEqual([])
  })
})
