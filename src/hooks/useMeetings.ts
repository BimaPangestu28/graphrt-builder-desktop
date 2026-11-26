import { getMeetingStatus, listMeetings, listenToMeetingList, listenToMeetingStatus } from '@/api/meetings'
import type { MeetingRecord, MeetingStatus } from '@/api/meetingTypes'
import { useAsyncData, type AsyncDataState } from './useAsyncData'
import { useBackendSubscription } from './useBackendSubscription'

/** The notetaker's status (prompt, recording, mic users), refreshed on every backend change. */
export function useMeetingStatus(): AsyncDataState<MeetingStatus> {
  const state = useAsyncData(getMeetingStatus, [])
  useBackendSubscription(listenToMeetingStatus, () => void state.reload())
  return state
}

/** Every meeting, newest first, refreshed when one is added, transcribed or deleted. */
export function useMeetingList(): AsyncDataState<MeetingRecord[]> {
  const state = useAsyncData(listMeetings, [])
  useBackendSubscription(listenToMeetingList, () => void state.reload())
  return state
}
