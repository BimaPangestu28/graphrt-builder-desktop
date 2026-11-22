import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * The sample backend is left out of the desktop build only if production code reaches it
 * through `src/api/*` (behind `__SAMPLE_BACKEND__`). A screen or hook importing it directly
 * would ship the fixtures again, so this test fails on any such import.
 */

const sourceRoot = join(__dirname, '..', '..')
const sampleBackendImport = /from\s+'[^']*sampleBackend\/[^']*'|import\('[^']*sampleBackend\/[^']*'\)/

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const entryPath = join(directory, entry)
    if (statSync(entryPath).isDirectory()) return listSourceFiles(entryPath)
    return /\.(ts|tsx)$/.test(entry) ? [entryPath] : []
  })
}

/** Test code may seed and reset the sample backend; production code outside src/api may not. */
function mayImportSampleBackend(relativePath: string): boolean {
  const posixPath = relativePath.split(sep).join('/')
  if (posixPath.startsWith('api/')) return true
  if (posixPath.startsWith('test/')) return true
  return /(^|\/)__tests__\//.test(posixPath) || /\.test\.tsx?$/.test(posixPath)
}

describe('sample backend boundary', () => {
  const sourceFiles = listSourceFiles(sourceRoot).map((filePath) => ({ filePath, relativePath: relative(sourceRoot, filePath) }))

  it('is imported only from src/api and tests', () => {
    const offenders = sourceFiles
      .filter(({ relativePath }) => !mayImportSampleBackend(relativePath))
      .filter(({ filePath }) => sampleBackendImport.test(readFileSync(filePath, 'utf8')))
      .map(({ relativePath }) => relativePath)
    expect(offenders).toEqual([])
  })

  it('has no src/data fixtures folder left to import from', () => {
    const offenders = sourceFiles.filter(({ filePath }) => /from\s+'@\/data\//.test(readFileSync(filePath, 'utf8'))).map(({ relativePath }) => relativePath)
    expect(offenders).toEqual([])
  })
})
