/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * The dark theme works by redefining the colour tokens of `index.css`. A fixed colour in a class name
 * (`text-white`, `bg-[#EFEAE2]`...) does not follow the theme and shows up as white text on a light button or
 * a light panel in a dark window, so components may only use the tokens.
 */

const sourceRoot = join(__dirname, '..')

function listComponentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'fixtures' ? [] : listComponentFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const colourUtility = '(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|placeholder|caret|accent)'
const fixedColourClass = new RegExp(`(?<![\\w-])!?${colourUtility}-(?:white|black|\\[#[0-9A-Fa-f]{3,8}\\])(?![\\w-])`, 'g')

function readTokenBlock(css: string, opening: string): Set<string> {
  const start = css.indexOf(opening)
  if (start < 0) throw new Error(`index.css has no "${opening}" block`)
  const block = css.slice(start, css.indexOf('\n}', start))
  return new Set([...block.matchAll(/(--color-[\w-]+)\s*:/g)].map((match) => match[1]))
}

describe('theme tokens', () => {
  it('components use colour tokens, never a fixed white, black or hex colour class', () => {
    const offences = listComponentFiles(sourceRoot).flatMap((path) => {
      const lines = readFileSync(path, 'utf8').split('\n')
      return lines.flatMap((line, index) => (line.match(fixedColourClass) ?? []).map((className) => `${relative(sourceRoot, path)}:${index + 1} ${className}`))
    })
    expect(offences).toEqual([])
  })

  it('the dark theme redefines every surface, ink and state colour', () => {
    const css = readFileSync(join(sourceRoot, 'index.css'), 'utf8')
    const lightTokens = readTokenBlock(css, '@theme {')
    const darkTokens = readTokenBlock(css, '[data-theme="dark"] {\n  color-scheme: dark;')
    // The brand accent dot is the same teal on both themes.
    const sameInBothThemes = new Set(['--color-teal'])
    const missing = [...lightTokens].filter((token) => !darkTokens.has(token) && !sameInBothThemes.has(token))
    expect(missing).toEqual([])
  })
})
