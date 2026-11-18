import { LogoMark } from '@/components/ui'

/** Dimmed, decorative outline of the builder that sits behind the dialog. */
export function BuilderBackdropSkeleton() {
  return (
    <>
      <div aria-hidden="true" className="box-border flex flex-[1_1_232px] flex-col gap-[18px] px-3.5 py-5">
        <div className="flex items-center gap-2.5 px-1.5">
          <LogoMark size={28} />
          <span className="text-[18px] font-bold">graphrt</span>
        </div>
        <div className="h-10 rounded-[10px] bg-ink" />
        <div className="h-[120px] rounded-[10px] bg-selected" />
        <div className="h-14 rounded-[10px] bg-brand-soft" />
      </div>
      <div aria-hidden="true" className="flex flex-[999_1_560px] flex-wrap">
        <div className="flex-[1_1_380px] border-r border-line bg-surface" />
        <div className="box-border flex flex-[1_1_440px] flex-col gap-2 bg-subtle px-6 py-[88px]">
          {[0, 1, 2, 3].map((placeholderIndex) => (
            <div key={placeholderIndex} className="h-[54px] rounded-xl border border-line bg-surface" />
          ))}
        </div>
      </div>
    </>
  )
}
