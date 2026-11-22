/** Vite's `?url` imports: the file is emitted as its own asset and the import is its URL. */
declare module '*?url' {
  const assetUrl: string
  export default assetUrl
}
