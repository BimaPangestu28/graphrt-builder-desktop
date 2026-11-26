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
