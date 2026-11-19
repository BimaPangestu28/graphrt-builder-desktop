/**
 * Plain one-paragraph preview of text that may hold Markdown and line breaks, for clamped
 * previews (the full text goes in a `title`). Handles the simple Markdown agents write:
 * headings, bold/italic, inline code, links, images, list markers, quotes and code fences.
 *
 * @param text - Raw text, possibly Markdown (string)
 * @returns The text without Markdown markers, all whitespace collapsed to single spaces (string)
 *
 * @example
 * toPreviewText('## Done\n\n**11** sent\n- 1 skipped') // "Done 11 sent 1 skipped"
 */
export function toPreviewText(text: string): string {
  return text
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\s](?:[^*_\n]*[^*_\s])?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
