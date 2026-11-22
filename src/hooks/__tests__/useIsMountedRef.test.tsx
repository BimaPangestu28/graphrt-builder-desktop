import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useIsMountedRef } from '../useIsMountedRef'

describe('useIsMountedRef', () => {
  it('is true while mounted and false after unmount', () => {
    const { result, unmount } = renderHook(() => useIsMountedRef())
    const isMountedRef = result.current
    expect(isMountedRef.current).toBe(true)
    unmount()
    expect(isMountedRef.current).toBe(false)
  })
})
