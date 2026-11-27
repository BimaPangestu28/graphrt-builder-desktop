/**
 * Class names for the two-column "chat | agent" screens (builder, generating, test run).
 * From the `lg` breakpoint the main panel fills the window height and each column scrolls on
 * its own, so the chat input and the agent header stay put. Narrower windows stack the columns
 * and the page scrolls as a whole.
 */

/** Main panel: window height minus the shell's 8px margins, columns side by side. */
export const splitPaneMainClassName = 'flex flex-wrap lg:h-[calc(100vh-1rem)] lg:flex-nowrap'

/** A column: full height of the main panel so its body can scroll. */
export const splitPaneColumnClassName = 'lg:h-full lg:min-h-0'

/**
 * The scrolling body of a column, between its fixed header and footer.
 *
 * `relative` keeps absolutely positioned content (every `sr-only` label and hint) inside the
 * scroller. Without it such an element is laid out against the page at its unscrolled offset,
 * far below the window once the column is long: the page itself became scrollable, and a
 * wheel turn at the end of a column slid the whole window up over an empty area.
 */
export const splitPaneScrollClassName = 'relative lg:min-h-0 lg:flex-1 lg:overflow-y-auto'
