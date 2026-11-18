import type { AgentStepSnapshot } from '@/data/versionHistory'

/**
 * Reads the steps of a graphrt workflow document well enough to compare versions on
 * screen 24: each node's `id`, `title` and `desc`. Only keys at the node's own
 * indentation are read, so prompts and nested settings never leak in. Helper nodes
 * (`end`, `iteration-start`, `loop-start`) are skipped.
 */

const hiddenNodeTypes = new Set(['end', 'iteration-start', 'loop-start'])
const nodeStartPattern = /^(\s*)- id:\s*(.+?)\s*$/
const nodeKeyPattern = /^(\s*)(type|title|desc):\s*(.*?)\s*$/

interface ParsedNode {
  id: string
  indentation: number
  type?: string
  title?: string
  desc?: string
}

function unquoteYamlScalar(rawValue: string): string {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      return JSON.parse(rawValue) as string
    } catch {
      return rawValue.slice(1, -1)
    }
  }
  if (rawValue.startsWith("'") && rawValue.endsWith("'")) return rawValue.slice(1, -1).replace(/''/g, "'")
  return rawValue
}

function parseNodes(flowYaml: string): ParsedNode[] {
  const parsedNodes: ParsedNode[] = []
  for (const line of flowYaml.split('\n')) {
    const nodeStart = line.match(nodeStartPattern)
    // Nested lists such as block-style `actions: - id: approve` sit deeper than the nodes.
    const isNodeStart = nodeStart && (parsedNodes.length === 0 || nodeStart[1].length === parsedNodes[0].indentation)
    if (nodeStart && isNodeStart) {
      parsedNodes.push({ id: unquoteYamlScalar(nodeStart[2]), indentation: nodeStart[1].length })
      continue
    }
    const currentNode = parsedNodes[parsedNodes.length - 1]
    const nodeKey = line.match(nodeKeyPattern)
    if (!currentNode || !nodeKey || nodeKey[1].length !== currentNode.indentation + 2) continue
    const key = nodeKey[2] as 'type' | 'title' | 'desc'
    currentNode[key] = unquoteYamlScalar(nodeKey[3])
  }
  return parsedNodes
}

/**
 * Extracts comparable steps from a workflow document.
 *
 * @param flowYaml - graphrt document as stored for a version (string)
 * @returns Steps in document order; `setting` is the node `desc` when present (AgentStepSnapshot[])
 *
 * @example
 * readStepSnapshots('graph:\n  nodes:\n    - id: hi\n      type: llm\n      title: Say hi') // [{ id: 'hi', name: 'Say hi' }]
 */
export function readStepSnapshots(flowYaml: string): AgentStepSnapshot[] {
  return parseNodes(flowYaml)
    .filter((parsedNode) => !parsedNode.type || !hiddenNodeTypes.has(parsedNode.type))
    .map((parsedNode) => ({ id: parsedNode.id, name: parsedNode.title || parsedNode.id, ...(parsedNode.desc ? { setting: parsedNode.desc } : {}) }))
}
