import { getMeetingStatus, listenToMeetingStatus } from '@/api/meetings'
import type { MeetingStatus } from '@/api/meetingTypes'
import { useAsyncData, type AsyncDataState } from './useAsyncData'
import { useBackendSubscription } from './useBackendSubscription'

/** The meeting notes status (prompt, recording, settings), refreshed on every backend change. */
export function useMeetingStatus(): AsyncDataState<MeetingStatus> {
  const state = useAsyncData(getMeetingStatus, [])
  useBackendSubscription(listenToMeetingStatus, () => void state.reload())
  return state
}
