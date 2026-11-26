/**
 * A read-only record whose values come from the current dictionary each time they are read, so
 * module-level label maps (`labels[key]`, `Object.values(labels)`) follow a language switch
 * without changing their call sites.
 *
 * @param read - Returns the record in the current language (() => Record)
 * @returns A live view of it (Readonly<Record>)
 *
 * @example
 * export const pluginCategoryLabels = localizedRecord(() => messages().plugins.categories)
 */
export function localizedRecord<Key extends string, Value>(read: () => Readonly<Record<Key, Value>>): Readonly<Record<Key, Value>> {
  return new Proxy({} as Record<Key, Value>, {
    get: (_target, property) => Reflect.get(read(), property),
    has: (_target, property) => Reflect.has(read(), property),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(read(), property)
      return descriptor ? { ...descriptor, configurable: true } : undefined
    },
  })
}

/**
 * Option lists declared at module level whose `label` follows the current language: each item
 * gets a `label` getter reading `labelOf(item)` from the dictionary.
 *
 * @example
 * export const viewModeOptions = withLocalizedLabels([{ mode: 'day' }, { mode: 'week' }], (option) => messages().schedule.views[option.mode])
 */
export function withLocalizedLabels<Item extends object>(items: readonly Item[], labelOf: (item: Item) => string): Array<Item & { readonly label: string }> {
  return items.map((item) => {
    const withLabel = { ...item } as Item & { readonly label: string }
    Object.defineProperty(withLabel, 'label', { get: () => labelOf(item), enumerable: true })
    return withLabel
  })
}

/**
 * A read-only array whose items come from the current dictionary on every access (indexing,
 * `map`, `find`, spreading), for module-level lists such as weekday names.
 */
export function localizedArray<Item>(read: () => readonly Item[]): readonly Item[] {
  return new Proxy([] as Item[], {
    get: (_target, property) => Reflect.get(read(), property),
    has: (_target, property) => Reflect.has(read(), property),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(read(), property)
      if (!descriptor) return undefined
      return property === 'length' ? descriptor : { ...descriptor, configurable: true }
    },
  })
}
