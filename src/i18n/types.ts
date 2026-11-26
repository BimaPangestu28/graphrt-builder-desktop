/**
 * Shape a translation must have: the same keys as the English source, every leaf a string or a
 * function with the same parameters returning a string. Assigning an object literal to it makes
 * TypeScript reject a missing key and an extra key, so the dictionaries cannot drift apart.
 */
export type Translation<Source> = Source extends string
  ? string
  : Source extends (...args: infer Args) => string
    ? (...args: Args) => string
    : Source extends readonly unknown[]
      ? { readonly [Index in keyof Source]: Translation<Source[Index]> }
      : { readonly [Key in keyof Source]: Translation<Source[Key]> }

/** The two languages of the UI. */
export type Locale = 'en' | 'id'

export const supportedLocales: readonly Locale[] = ['en', 'id']

/** Both dictionaries of one area of the app, the English one being the source of truth. */
export interface MessagePair<Source> {
  en: Source
  id: Translation<Source>
}

/**
 * Pairs the English source with its Indonesian translation. The type parameter comes from `en`
 * only, so `id` is checked against it key by key.
 *
 * @param en - English strings (object)
 * @param id - Indonesian strings, same shape (object)
 * @returns Both (MessagePair)
 */
export function defineMessages<Source>(en: Source, id: Translation<NoInfer<Source>>): MessagePair<Source> {
  return { en, id }
}
