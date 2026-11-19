import { LinkButton, joinClassNames } from '@/components/ui'
import type { AttentionItem } from '@/data/homeDashboard'
import { HomeSectionHeader } from './HomeSectionHeader'
import { toPreviewText } from '@/lib/previewText'

interface NeedsYouSectionProps {
  /** Null while runs are loading. */
  items: AttentionItem[] | null
  loadError: Error | null
}

/** Title, a two-line preview of the detail (full text on hover) and the small meta line. */
function NeedsYouRowText({ item }: { item: AttentionItem }) {
  const detailPreview = toPreviewText(item.detail)
  return (
    <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
      <span className="font-semibold">{item.title}</span>
      {detailPreview && (
        <span className="line-clamp-2 break-words text-body" title={item.detail}>
          {detailPreview}
        </span>
      )}
      {item.meta && <span className="text-[12px] text-muted">{item.meta}</span>}
    </div>
  )
}

function NeedsYouList({ items }: { items: AttentionItem[] }) {
  return (
    <ul className="m-0 list-none rounded-[14px] border border-amber-line bg-surface p-0">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-chip px-[18px] py-3.5 last:border-b-0">
          <NeedsYouRowText item={item} />
          <LinkButton
            to={item.actionPath}
            variant={item.isPrimaryAction ? 'primary' : 'secondary'}
            size="sm"
            className={joinClassNames('ml-auto !h-9 shrink-0 !rounded-[9px] !px-3.5', item.isPrimaryAction ? '!text-white' : '!text-ink')}
          >
            {item.actionLabel}
          </LinkButton>
        </li>
      ))}
    </ul>
  )
}

function NeedsYouBody({ items, loadError }: NeedsYouSectionProps) {
  if (loadError) return <p className="m-0 text-muted">Could not check what needs you: {loadError.message}</p>
  if (!items) return <p className="m-0 text-muted">Checking what needs you…</p>
  if (items.length === 0) return <p className="m-0 text-muted">Nothing needs you right now</p>
  return <NeedsYouList items={items} />
}

/** Amber-bordered list of things waiting on the user (most urgent first), each with one action button. */
export function NeedsYouSection({ items, loadError }: NeedsYouSectionProps) {
  return (
    <section aria-labelledby="home-needs-you" className="flex flex-col gap-3">
      <HomeSectionHeader
        headingId="home-needs-you"
        heading={
          <>
            Needs you
            {items && items.length > 0 && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[12px] text-amber-strong">{items.length}</span>}
          </>
        }
      />
      <NeedsYouBody items={items} loadError={loadError} />
    </section>
  )
}
