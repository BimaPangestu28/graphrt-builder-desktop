import { Link } from 'react-router-dom'
import { Icon, StrokeIcon, joinClassNames } from '@/components/ui'
import { stepCatalogTabs, type StepCatalogCategory, type StepCatalogItem } from '@/data/agentAsStep'
import { routePaths } from '@/routes'

interface CatalogItemCardProps {
  item: StepCatalogItem
  isAdded: boolean
  onAdd: (itemId: string) => void
}

function CatalogItemAction({ item, isAdded, onAdd }: CatalogItemCardProps) {
  if (isAdded) return <span className="text-[12px] font-medium text-ok-strong">Added</span>
  if (item.needsNoInput) return <span className="text-[12px] text-muted">Needs no input</span>
  return (
    <button
      type="button"
      aria-label={`Add ${item.name}`}
      onClick={() => onAdd(item.id)}
      className="h-[30px] cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[12px] font-medium text-ink hover:bg-subtle"
    >
      Add
    </button>
  )
}

function CatalogItemCard(props: CatalogItemCardProps) {
  const { item, isAdded } = props
  return (
    <div className={joinClassNames('flex flex-col gap-2 rounded-xl bg-surface p-3.5', isAdded ? 'border-2 border-ink' : 'border border-line')}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{item.name}</span>
        <CatalogItemAction {...props} />
      </div>
      <span className="leading-normal text-body">{item.description}</span>
      <span className="text-[12px] text-muted">{[item.signature, item.usageNote].filter(Boolean).join(' · ')}</span>
    </div>
  )
}

interface AddStepPanelProps {
  searchText: string
  onSearchTextChange: (searchText: string) => void
  activeCategory: StepCatalogCategory
  onCategoryChange: (category: StepCatalogCategory) => void
  visibleItems: StepCatalogItem[]
  addedItemId: string | undefined
  onAddItem: (itemId: string) => void
}

/** Right panel of screen 12: search, Built-in / My agents / Plugins tabs, and catalog cards with Add buttons. */
export function AddStepPanel({ searchText, onSearchTextChange, activeCategory, onCategoryChange, visibleItems, addedItemId, onAddItem }: AddStepPanelProps) {
  return (
    <aside aria-labelledby="add-step-heading" className="box-border flex min-w-0 flex-[1_1_360px] flex-col gap-4 border-l border-line bg-subtle p-6">
      <div className="flex items-center justify-between">
        <h2 id="add-step-heading" className="m-0 text-[18px] font-semibold">
          Add a step
        </h2>
        <Link to={routePaths.chain} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg !text-ink-2 hover:bg-chip">
          <Icon name="close" size={16} />
        </Link>
      </div>
      <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3">
        <StrokeIcon size={15} className="shrink-0 text-muted">
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4.5-4.5" />
        </StrokeIcon>
        <input
          type="search"
          aria-label="Search steps"
          placeholder="Search steps and agents"
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          className="min-w-0 flex-auto border-0 bg-transparent text-[14px] text-ink outline-none"
        />
      </label>
      <div role="tablist" aria-label="Step sources" className="flex gap-1 rounded-[10px] bg-selected p-1">
        {stepCatalogTabs.map((tab) => {
          const isSelected = tab.category === activeCategory
          return (
            <button
              key={tab.category}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onCategoryChange(tab.category)}
              className={joinClassNames(
                'h-8 flex-[1_1_0] cursor-pointer rounded-[7px] border-0 text-[13px]',
                isSelected ? 'bg-surface font-semibold text-ink' : 'bg-transparent font-medium text-body',
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" aria-label={stepCatalogTabs.find((tab) => tab.category === activeCategory)?.label} className="flex flex-col gap-2">
        {visibleItems.length === 0 && <p className="m-0 text-[13px] text-muted">Nothing matches “{searchText}”</p>}
        {visibleItems.map((item) => (
          <CatalogItemCard key={item.id} item={item} isAdded={item.id === addedItemId} onAdd={onAddItem} />
        ))}
      </div>
      <p className="m-0 text-[13px] leading-normal text-body">
        An agent works as a step when it says what it needs and what it gives back. Approvals inside it still come to you
      </p>
    </aside>
  )
}
