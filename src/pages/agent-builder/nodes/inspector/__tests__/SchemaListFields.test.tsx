import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { AgentGraph, JsonValue } from '@/api/agentGraphTypes'
import { createGraphNode } from '../../graphEdits'
import type { AgentGraphController } from '../../useAgentGraph'
import type { JsonObject } from '../configPaths'
import { InspectorProvider } from '../InspectorContext'
import { SchemaForm } from '../SchemaForm'

const pluginNode = createGraphNode({ id: 'tag', kind: 'crm.tag', title: 'Tag leads', config: {} })
const graph: AgentGraph = { agentId: 'a', version: 1, latestVersion: 1, name: null, nodes: [pluginNode], edges: [], inputs: [], env: [], problems: [] }

const schema = {
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string' } },
    rules: {
      type: 'array',
      items: { type: 'object', properties: { field: { type: 'string' }, weight: { type: 'integer' }, strict: { type: 'boolean' } }, required: ['field'] },
    },
  },
}

const written: { config: JsonObject } = { config: {} }

function Form({ initial }: { initial: JsonObject }) {
  const [config, setConfig] = useState<JsonObject>(initial)
  written.config = config
  return (
    <InspectorProvider node={pluginNode} graph={graph} kindInfo={null} nodeKinds={[]} readOnly={false} controller={{} as AgentGraphController}>
      <SchemaForm
        schema={schema}
        config={config}
        onChange={(name, value: JsonValue | undefined) =>
          setConfig((current) => {
            const next = { ...current }
            if (value === undefined) delete next[name]
            else next[name] = value
            return next
          })
        }
      />
    </InspectorProvider>
  )
}

describe('schema form lists', () => {
  it('edits a list of texts as rows instead of JSON', () => {
    render(<Form initial={{ tags: ['hot'] }} />)
    const group = screen.getByRole('group', { name: 'Tags' })
    expect(within(group).getByRole('textbox', { name: 'Tags 1' })).toHaveValue('hot')
    fireEvent.click(within(group).getByRole('button', { name: 'Add' }))
    const second = within(group).getByRole('textbox', { name: 'Tags 2' })
    fireEvent.change(second, { target: { value: 'cold' } })
    fireEvent.blur(second)
    expect(written.config.tags).toEqual(['hot', 'cold'])
    fireEvent.click(within(group).getByRole('button', { name: 'Remove tags 1' }))
    expect(written.config.tags).toEqual(['cold'])
  })

  it('edits a list of simple objects as cards, keeping keys it does not show', () => {
    render(<Form initial={{ rules: [{ field: 'phone', weight: 2, note: 'kept' }] }} />)
    const list = screen.getByRole('list', { name: 'Rules' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    const weight = within(list).getByRole('spinbutton', { name: 'Weight' })
    fireEvent.change(weight, { target: { value: '5' } })
    fireEvent.blur(weight)
    expect(written.config.rules).toEqual([{ field: 'phone', weight: 5, note: 'kept' }])
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' }).at(-1)!)
    expect(written.config.rules).toEqual([{ field: 'phone', weight: 5, note: 'kept' }, { field: '' }])
    expect(screen.queryByText('JSON')).not.toBeInTheDocument()
  })
})
