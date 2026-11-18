import { useState } from 'react'
import { AppShell } from '@/components/layout'
import { filterStepCatalog, initialInsertedStepId, stepCatalogItems, type StepCatalogCategory } from '@/data/agentAsStep'
import { AddStepPanel } from './agent-as-step/AddStepPanel'
import { AgentStepList } from './agent-as-step/AgentStepList'

/**
 * Screen 12 · Agent as a step.
 * Inserting one of your own agents (or a built-in step or plugin) into another agent's steps.
 * The catalog on the right is searchable and tabbed; clicking Add swaps the highlighted step on the left.
 */
export function AgentAsStepPage() {
  const [searchText, setSearchText] = useState('')
  const [activeCategory, setActiveCategory] = useState<StepCatalogCategory>('myAgents')
  const [addedItemId, setAddedItemId] = useState<string | undefined>(initialInsertedStepId)
  const [isVersionPinned, setIsVersionPinned] = useState(true)

  const visibleItems = filterStepCatalog(stepCatalogItems, { category: activeCategory, searchText })
  const insertedItem = stepCatalogItems.find((item) => item.id === addedItemId)

  return (
    <AppShell agents={{ kind: 'list' }} mainClassName="flex flex-wrap">
      <AgentStepList insertedItem={insertedItem} isVersionPinned={isVersionPinned} onVersionPinnedChange={setIsVersionPinned} />
      <AddStepPanel
        searchText={searchText}
        onSearchTextChange={setSearchText}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        visibleItems={visibleItems}
        addedItemId={addedItemId}
        onAddItem={(itemId) => {
          setAddedItemId(itemId)
          setIsVersionPinned(true)
        }}
      />
    </AppShell>
  )
}
