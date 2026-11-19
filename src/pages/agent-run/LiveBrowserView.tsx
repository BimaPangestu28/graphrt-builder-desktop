interface LiveBrowserViewProps {
  /** Latest JPEG data URL of the page, or null before the first one arrives. */
  image: string | null
}

/**
 * A small, live-updating picture of what the headless browser of a running step sees.
 * Shown only while the step runs; nothing is saved with the run.
 */
export function LiveBrowserView({ image }: LiveBrowserViewProps) {
  return (
    <figure aria-label="Live view of the browser" className="m-0 flex w-full max-w-[360px] flex-col gap-1">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-line bg-subtle">
        {image ? (
          <img src={image} alt="What the browser shows right now" className="block size-full object-contain object-top" />
        ) : (
          <span role="status" className="text-[13px] text-muted">
            Waiting for the browser…
          </span>
        )}
      </div>
      <figcaption className="flex items-center gap-1.5 text-[12px] text-muted">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-danger motion-safe:animate-pulse" />
        Live · stays on this Mac, not saved
      </figcaption>
    </figure>
  )
}
