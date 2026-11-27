import { splitPaneScrollClassName } from './splitPane'

describe('splitPaneScrollClassName', () => {
  // jsdom lays nothing out, so the class is checked instead: without `relative` an `sr-only`
  // label deep in a long column makes the page itself scrollable (the whole window slid up).
  it('keeps absolutely positioned content inside the scrolling column', () => {
    expect(splitPaneScrollClassName.split(' ')).toContain('relative')
    expect(splitPaneScrollClassName).toContain('lg:overflow-y-auto')
  })
})
