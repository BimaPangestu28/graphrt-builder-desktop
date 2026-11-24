import { createFileDropRouter, findZoneAt, type DropZoneRegistration, type WindowDragDropEvent } from '../fileDropRouter'

function zoneAt(left: number, top: number, width: number, height: number) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, top, width, height))
  const zone: DropZoneRegistration & { hoverChanges: Array<string[] | null>; drops: string[][] } = {
    hoverChanges: [],
    drops: [],
    getElement: () => element,
    onHoverChange: (paths) => zone.hoverChanges.push(paths),
    onDrop: (paths) => zone.drops.push(paths),
  }
  return { zone, element }
}

function fakeSource() {
  let listener: ((event: WindowDragDropEvent) => void) | null = null
  const unsubscribe = vi.fn(() => {
    listener = null
  })
  const source = vi.fn(async (onEvent: (event: WindowDragDropEvent) => void) => {
    listener = onEvent
    return unsubscribe
  })
  return { source, unsubscribe, emit: (event: WindowDragDropEvent) => listener?.(event) }
}

describe('findZoneAt', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds the zone under the point and the smallest of nested zones', () => {
    const outer = zoneAt(0, 0, 400, 400).zone
    const inner = zoneAt(50, 50, 100, 100).zone
    expect(findZoneAt([outer, inner], { x: 75, y: 75 })).toBe(inner)
    expect(findZoneAt([outer, inner], { x: 300, y: 300 })).toBe(outer)
    expect(findZoneAt([outer, inner], { x: 500, y: 10 })).toBeNull()
  })

  it('skips zones that are detached or not laid out', () => {
    const { zone: detached, element } = zoneAt(0, 0, 100, 100)
    element.remove()
    const hidden = zoneAt(0, 0, 0, 0).zone
    expect(findZoneAt([detached, hidden], { x: 0, y: 0 })).toBeNull()
  })
})

describe('createFileDropRouter', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('routes hover and drop to the zone under the pointer only', async () => {
    const { source, emit } = fakeSource()
    const router = createFileDropRouter(source)
    const left = zoneAt(0, 0, 100, 100).zone
    const right = zoneAt(200, 0, 100, 100).zone
    router.register(left)
    router.register(right)
    await Promise.resolve()

    emit({ type: 'enter', paths: ['/a/Menu.pdf'], position: { x: 50, y: 50 } })
    expect(left.hoverChanges).toEqual([['/a/Menu.pdf']])
    emit({ type: 'over', position: { x: 250, y: 50 } })
    expect(left.hoverChanges).toEqual([['/a/Menu.pdf'], null])
    expect(right.hoverChanges).toEqual([['/a/Menu.pdf']])
    emit({ type: 'drop', paths: ['/a/Menu.pdf'], position: { x: 250, y: 50 } })
    expect(right.drops).toEqual([['/a/Menu.pdf']])
    expect(left.drops).toEqual([])
    expect(right.hoverChanges.at(-1)).toBeNull()
  })

  it('ignores drops outside every zone and clears the highlight on leave', async () => {
    const { source, emit } = fakeSource()
    const router = createFileDropRouter(source)
    const zone = zoneAt(0, 0, 100, 100).zone
    router.register(zone)
    await Promise.resolve()

    emit({ type: 'drop', paths: ['/a/Menu.pdf'], position: { x: 500, y: 500 } })
    expect(zone.drops).toEqual([])
    emit({ type: 'enter', paths: ['/a/Menu.pdf'], position: { x: 10, y: 10 } })
    emit({ type: 'leave' })
    expect(zone.hoverChanges).toEqual([['/a/Menu.pdf'], null])
  })

  it('listens while a zone is registered and stops after the last one leaves', async () => {
    const { source, unsubscribe } = fakeSource()
    const router = createFileDropRouter(source)
    const unregisterFirst = router.register(zoneAt(0, 0, 10, 10).zone)
    const unregisterSecond = router.register(zoneAt(0, 0, 10, 10).zone)
    await Promise.resolve()
    expect(source).toHaveBeenCalledTimes(1)
    unregisterFirst()
    expect(unsubscribe).not.toHaveBeenCalled()
    unregisterSecond()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('stops a subscription that resolves after every zone left', async () => {
    const { source, unsubscribe } = fakeSource()
    const router = createFileDropRouter(source)
    router.register(zoneAt(0, 0, 10, 10).zone)()
    await Promise.resolve()
    await Promise.resolve()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
