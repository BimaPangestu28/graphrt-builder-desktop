/**
 * The Markdown subset Adaptive Cards allow in TextBlock and FactSet text: **bold**, _italic_ (or *italic*),
 * [links](https://...), bulleted (`- `) and numbered (`1. `) lists and line breaks. It is parsed into plain
 * tokens that the view renders as React elements: no HTML is ever parsed or injected, so `<script>` in a card
 * is just text.
 */

export type InlineToken =
  | { kind: 'text'; text: string; bold: boolean; italic: boolean }
  | { kind: 'link'; text: string; url: string; bold: boolean; italic: boolean }

export type TextBlockPart =
  | { kind: 'paragraph'; tokens: InlineToken[] }
  | { kind: 'bullets'; items: InlineToken[][] }
  | { kind: 'numbered'; start: number; items: InlineToken[][] }

const linkPattern = /^\[([^\]\n]{1,500})\]\(([^)\s]{1,2048})\)/

/**
 * Inline tokens of one line.
 *
 * @example
 * parseInline('Pay **Rp 250.000** now') // text "Pay ", bold text "Rp 250.000", text " now"
 */
export function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let bold = false
  let italic = false
  let buffer = ''
  const flush = () => {
    if (buffer) tokens.push({ kind: 'text', text: buffer, bold, italic })
    buffer = ''
  }
  for (let index = 0; index < line.length; ) {
    const rest = line.slice(index)
    if (rest.startsWith('**') || rest.startsWith('__')) {
      const marker = rest.slice(0, 2)
      if (bold || line.indexOf(marker, index + 2) > index + 2) {
        flush()
        bold = !bold
        index += 2
        continue
      }
    }
    const char = line[index]
    const previous = index > 0 ? line[index - 1] : ' '
    if ((char === '_' || char === '*') && (italic || (/[\s(]/.test(previous) && line.indexOf(char, index + 1) > index + 1))) {
      flush()
      italic = !italic
      index += 1
      continue
    }
    const link = char === '[' ? linkPattern.exec(rest) : null
    if (link) {
      flush()
      tokens.push({ kind: 'link', text: link[1], url: link[2], bold, italic })
      index += link[0].length
      continue
    }
    buffer += char
    index += 1
  }
  flush()
  return tokens
}

/**
 * Paragraphs and lists of a TextBlock's text, in order. Consecutive list lines form one list.
 *
 * @param text - The TextBlock `text` (string)
 * @returns Parts to render (TextBlockPart[])
 */
export function parseCardMarkdown(text: string): TextBlockPart[] {
  const parts: TextBlockPart[] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const numbered = /^\s*(\d{1,6})\.\s+(.*)$/.exec(line)
    const last = parts.at(-1)
    if (bullet) {
      const tokens = parseInline(bullet[1])
      if (last?.kind === 'bullets') last.items.push(tokens)
      else parts.push({ kind: 'bullets', items: [tokens] })
    } else if (numbered) {
      const tokens = parseInline(numbered[2])
      if (last?.kind === 'numbered') last.items.push(tokens)
      else parts.push({ kind: 'numbered', start: Number(numbered[1]), items: [tokens] })
    } else {
      parts.push({ kind: 'paragraph', tokens: parseInline(line) })
    }
  }
  return parts
}

/** Link targets a card may open: https and mailto (the backend checks again before opening). */
export function isSafeCardLink(url: string): boolean {
  return /^https:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/i.test(url) || /^mailto:\S+$/i.test(url)
}
