import { BackendError } from '../client'

/** Placeholder for sample-backend calls that have no sample behaviour yet. */
export function sampleNotImplemented(operation: string): Promise<never> {
  return Promise.reject(new BackendError('internal', `${operation} is only available in the desktop app`))
}
