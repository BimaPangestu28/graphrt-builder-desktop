import { buildFixStepPath, describeFixStepRequest, fixStepErrorMaxLength } from './fixStepRequest'

const searchStep = { id: 'search_maps', label: 'Search Google Maps', errorMessage: 'http: 403 Forbidden.' }

describe('describeFixStepRequest', () => {
  it('names the step and its id, quotes the error and asks for a fix', () => {
    expect(describeFixStepRequest(searchStep)).toBe('The step "Search Google Maps" (search_maps) failed with: http: 403 Forbidden. Please fix this step.')
  })

  it('uses only the id when the step has no separate title', () => {
    expect(describeFixStepRequest({ id: 'search_maps', label: 'search_maps', errorMessage: null })).toBe('The step "search_maps" failed. Please fix this step.')
  })

  it('shortens very long errors to about 500 characters on one line', () => {
    const longError = `line one\n${'x'.repeat(2000)}`
    const request = describeFixStepRequest({ ...searchStep, errorMessage: longError })
    const quotedError = request.slice(request.indexOf(': ') + 2, request.lastIndexOf('. Please'))
    expect(quotedError).toHaveLength(fixStepErrorMaxLength)
    expect(quotedError.startsWith('line one x')).toBe(true)
    expect(quotedError.endsWith('…')).toBe(true)
  })

  it('hides values that look like credentials', () => {
    const request = describeFixStepRequest({
      ...searchStep,
      errorMessage: 'GET https://api.example.com/?api_key=abc123secret failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload sk-proj-1234567890abcdef',
    })
    expect(request).not.toMatch(/abc123secret|eyJhbGci|sk-proj-1234567890abcdef/)
    expect(request).toContain('api_key=[hidden]')
  })
})

describe('buildFixStepPath', () => {
  it('opens the agent builder with the request in the ask param', () => {
    const fixUrl = new URL(buildFixStepPath('agent 1', searchStep), 'http://localhost')
    expect(fixUrl.pathname).toBe('/agents/agent%201/steps')
    expect(fixUrl.searchParams.get('ask')).toBe(describeFixStepRequest(searchStep))
  })
})
