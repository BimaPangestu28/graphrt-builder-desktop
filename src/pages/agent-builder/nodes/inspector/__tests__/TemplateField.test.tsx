import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetSampleAgentGraphs } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { serializeEditor } from '../TemplateField'
import { addFixtureNodes, currentNode, renderInspector } from './inspectorTestHarness'

/** Puts the caret in the editor's text node `textIndex` at `offset` (what a click there does). */
function placeCaret(editor: HTMLElement, textIndex: number, offset: number) {
  const textNodes = [...editor.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE)
  const range = document.createRange()
  range.setStart(textNodes[textIndex], offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  fireEvent.keyUp(editor)
}

async function insertValue(user: ReturnType<typeof userEvent.setup>, search: string, optionName: RegExp) {
  await user.click(screen.getByRole('button', { name: 'Insert value {' }))
  await user.type(screen.getByRole('searchbox', { name: 'Search values' }), search)
  await user.click(within(screen.getByRole('listbox', { name: /Insert a value/ })).getAllByRole('option', { name: optionName })[0])
}

describe('TemplateField chip editor', () => {
  beforeEach(async () => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    await addFixtureNodes()
  })

  it('inserts a chip mid-text and keeps typing right after it', async () => {
    const user = userEvent.setup()
    await renderInspector('add_to_crm')
    const url = screen.getByRole('textbox', { name: 'URL' })
    await user.click(url)
    placeCaret(url, 0, 'https://api.example.com/'.length)

    await insertValue(user, 'keyword', /keyword/)

    expect(document.activeElement).toBe(url)
    expect(serializeEditor(url)).toBe('https://api.example.com/{{#ask_input.keyword#}}leads')
    await user.keyboard('/x')
    expect(serializeEditor(url)).toBe('https://api.example.com/{{#ask_input.keyword#}}/xleads')
    await user.tab()
    expect(currentNode('add_to_crm').config.url).toBe('https://api.example.com/{{#ask_input.keyword#}}/xleads')
  })

  it('types after a chip inserted at the end of the text', async () => {
    const user = userEvent.setup()
    await renderInspector('add_to_crm')
    const url = screen.getByRole('textbox', { name: 'URL' })
    await user.click(url)
    placeCaret(url, 0, 'https://api.example.com/leads'.length)

    await insertValue(user, 'keyword', /keyword/)
    await user.keyboard('?page=2')

    expect(serializeEditor(url)).toBe('https://api.example.com/leads{{#ask_input.keyword#}}?page=2')
    await user.tab()
    expect(currentNode('add_to_crm').config.url).toBe('https://api.example.com/leads{{#ask_input.keyword#}}?page=2')
  })

  it('inserts two chips in a row at the caret', async () => {
    const user = userEvent.setup()
    await renderInspector('add_to_crm')
    const url = screen.getByRole('textbox', { name: 'URL' })
    await user.click(url)
    placeCaret(url, 0, 'https://'.length)

    await insertValue(user, 'keyword', /keyword/)
    await insertValue(user, 'city', /city/)
    await user.keyboard('.')

    expect(serializeEditor(url)).toBe('https://{{#ask_input.keyword#}}{{#ask_input.city#}}.api.example.com/leads')
  })

  it('places the caret after a chip that ends the saved text', async () => {
    const user = userEvent.setup()
    await renderInspector('search_maps')
    const query = screen.getByRole('textbox', { name: 'Query' })
    // "{{#ask_input.keyword#}} in {{#ask_input.city#}}" ends with a chip: there is a text spot after it.
    expect(query.lastChild?.nodeType).toBe(Node.TEXT_NODE)
    await user.click(query)
    placeCaret(query, [...query.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).length - 1, query.lastChild?.textContent?.length ?? 0)
    await user.keyboard(', Indonesia')
    await user.tab()

    expect(currentNode('search_maps').config.query).toBe('{{#ask_input.keyword#}} in {{#ask_input.city#}}, Indonesia')
  })

  it('never saves the caret spot marker', () => {
    const editor = document.createElement('div')
    editor.append(document.createTextNode('a'), Object.assign(document.createElement('span'), { textContent: 'x' }), document.createTextNode('​'))
    editor.children[0].setAttribute('data-reference', 'ask_input.city')
    expect(serializeEditor(editor)).toBe('a{{#ask_input.city#}}')
  })
})
