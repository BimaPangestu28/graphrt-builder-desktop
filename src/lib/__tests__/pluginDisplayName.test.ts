import { findPluginDisplayName, humanizePluginName, pluginDisplayName } from '../pluginDisplayName'

describe('humanizePluginName', () => {
  it('turns technical names into title-case words', () => {
    expect(humanizePluginName('currency-rates')).toBe('Currency Rates')
    expect(humanizePluginName('google-maps-scraper')).toBe('Google Maps Scraper')
    expect(humanizePluginName('echo')).toBe('Echo')
    expect(humanizePluginName('pdf-to-text')).toBe('PDF to Text')
    expect(humanizePluginName('some__odd--name')).toBe('Some Odd Name')
  })

  it('writes acronyms in capitals, including the -api suffix', () => {
    expect(humanizePluginName('x-api')).toBe('X API')
    const expectedByName: Record<string, string> = {
      'ai-summary': 'AI Summary',
      'crm-sync': 'CRM Sync',
      'csv-tools': 'CSV Tools',
      'qr-code': 'QR Code',
      'sql-query': 'SQL Query',
      sftp: 'SFTP',
      'rss-reader': 'RSS Reader',
      ocr: 'OCR',
      's3-upload': 'S3 Upload',
      bmkg: 'BMKG',
    }
    for (const [pluginName, expected] of Object.entries(expectedByName)) expect(humanizePluginName(pluginName)).toBe(expected)
  })

  it('keeps the spelling of known brands', () => {
    expect(humanizePluginName('github')).toBe('GitHub')
    expect(humanizePluginName('openai-images')).toBe('OpenAI Images')
    expect(humanizePluginName('whatsapp-api')).toBe('WhatsApp API')
    expect(humanizePluginName('youtube-transcripts')).toBe('YouTube Transcripts')
  })

  it('leaves blank names blank and does not treat inherited keys as brands', () => {
    expect(humanizePluginName('')).toBe('')
    expect(humanizePluginName('--')).toBe('')
    expect(humanizePluginName('constructor')).toBe('Constructor')
  })
})

describe('pluginDisplayName', () => {
  it('prefers the curated display name', () => {
    expect(pluginDisplayName({ name: 'whatsapp-api', displayName: 'WhatsApp Cloud API' })).toBe('WhatsApp Cloud API')
    expect(pluginDisplayName({ name: 'bmkg', displayName: '  BMKG Weather ' })).toBe('BMKG Weather')
  })

  it('falls back to the humanized name when there is none', () => {
    expect(pluginDisplayName({ name: 'currency-rates' })).toBe('Currency Rates')
    expect(pluginDisplayName({ name: 'currency-rates', displayName: null })).toBe('Currency Rates')
    expect(pluginDisplayName({ name: 'currency-rates', displayName: '   ' })).toBe('Currency Rates')
  })
})

describe('findPluginDisplayName', () => {
  it('looks the name up in known plugins, else humanizes it', () => {
    const knownPlugins = [{ name: 'github', displayName: 'GitHub Issues' }]
    expect(findPluginDisplayName(knownPlugins, 'github')).toBe('GitHub Issues')
    expect(findPluginDisplayName(knownPlugins, 'openai-images')).toBe('OpenAI Images')
    expect(findPluginDisplayName([], 'whatsapp-api')).toBe('WhatsApp API')
  })
})
