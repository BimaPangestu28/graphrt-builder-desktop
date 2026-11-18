import { useEffect, useRef } from 'react'

/**
 * Subscribes to a backend event stream while the component is mounted. `onEvent` may
 * change between renders without resubscribing; a subscription that resolves after
 * unmount is closed at once.
 *
 * @param subscribe - Starts listening, e.g. `listenToPluginEvents` ((onEvent) => Promise<() => void>)
 * @param onEvent - Called with each payload ((payload) => void)
 */
export function useBackendSubscription<Payload>(
  subscribe: (onEvent: (payload: Payload) => void) => Promise<() => void>,
  onEvent: (payload: Payload) => void,
): void {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    let isSubscribed = true
    let unsubscribe: (() => void) | null = null
    subscribe((payload) => onEventRef.current(payload))
      .then((stopListening) => {
        if (isSubscribed) unsubscribe = stopListening
        else stopListening()
      })
      .catch((subscribeError: unknown) => console.error('Could not subscribe to backend events', subscribeError))
    return () => {
      isSubscribed = false
      unsubscribe?.()
    }
  }, [subscribe])
}
